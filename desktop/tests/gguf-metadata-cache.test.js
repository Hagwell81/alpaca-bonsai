/* eslint-env node */
const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  GGUFMetadataCache,
  parseGGUFMetadata,
  GGUF_TYPES,
} = require('../gguf-metadata-cache');

describe('gguf-metadata-cache', () => {
  let tmpDir;
  let cacheFile;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'gguf-cache-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    cacheFile = path.join(tmpDir, 'cache.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('load / save', () => {
    it('should start empty when cache file is missing', async () => {
      const cache = new GGUFMetadataCache(cacheFile);
      await cache.load();
      expect(cache.entries.size).to.equal(0);
    });

    it('should persist entries across save and load', async () => {
      const cache = new GGUFMetadataCache(cacheFile);
      cache.entries.set('/models/a.gguf', {
        filePath: '/models/a.gguf',
        mtime: 1234567890,
        architecture: 'llama',
        quantization: 'Q4_K_M',
        layerCount: 32,
        contextLength: 4096,
        parameterCount: 7000000000,
        fileSizeMB: 4096,
        parsedAt: new Date().toISOString(),
      });
      cache.dirty = true;

      await cache.save();
      expect(fs.existsSync(cacheFile)).to.be.true;

      const cache2 = new GGUFMetadataCache(cacheFile);
      await cache2.load();
      expect(cache2.entries.size).to.equal(1);
      expect(cache2.entries.get('/models/a.gguf').architecture).to.equal('llama');
    });

    it('should not write when not dirty', async () => {
      const cache = new GGUFMetadataCache(cacheFile);
      await cache.save();
      expect(fs.existsSync(cacheFile)).to.be.false;
    });
  });

  describe('getMetadata', () => {
    it('should call parser on cache miss and cache the result', async () => {
      const modelFile = path.join(tmpDir, 'model.gguf');
      fs.writeFileSync(modelFile, 'not-a-real-gguf');

      const mockParser = (p) => ({
        architecture: 'mistral',
        quantization: 'Q5_K_M',
        layerCount: 32,
        contextLength: 8192,
        parameterCount: 7000000000,
        fileSizeMB: 4200,
      });

      const cache = new GGUFMetadataCache(cacheFile, { parser: mockParser });
      const entry = await cache.getMetadata(modelFile);

      expect(entry.architecture).to.equal('mistral');
      expect(entry.quantization).to.equal('Q5_K_M');
      expect(entry.filePath).to.equal(modelFile);
      expect(entry.mtime).to.be.a('number');
      expect(cache.entries.has(modelFile)).to.be.true;
      expect(cache.dirty).to.be.true;
    });

    it('should return cached entry when mtime matches', async () => {
      const modelFile = path.join(tmpDir, 'model.gguf');
      fs.writeFileSync(modelFile, 'some-data');
      const stats = fs.statSync(modelFile);

      const cache = new GGUFMetadataCache(cacheFile, {
        parser: () => ({ architecture: 'llama', quantization: 'Q4_0', layerCount: 1, contextLength: 1, parameterCount: 1, fileSizeMB: 1 }),
      });

      // Prime cache
      await cache.getMetadata(modelFile);
      cache.dirty = false;

      // Second call should hit cache
      const parserCalls = [];
      const cache2 = new GGUFMetadataCache(cacheFile, {
        parser: (p) => {
          parserCalls.push(p);
          return { architecture: 'llama', quantization: 'Q4_0', layerCount: 1, contextLength: 1, parameterCount: 1, fileSizeMB: 1 };
        },
      });
      cache2.entries = cache.entries;

      const entry = await cache2.getMetadata(modelFile);
      expect(parserCalls).to.have.lengthOf(0);
      expect(entry.architecture).to.equal('llama');
    });

    it('should re-parse when mtime changes', async () => {
      const modelFile = path.join(tmpDir, 'model.gguf');
      fs.writeFileSync(modelFile, 'v1');

      let parserCallCount = 0;
      const parser = () => {
        parserCallCount++;
        return { architecture: `v${parserCallCount}`, quantization: 'Q4_0', layerCount: 1, contextLength: 1, parameterCount: 1, fileSizeMB: 1 };
      };

      const cache = new GGUFMetadataCache(cacheFile, { parser });
      await cache.getMetadata(modelFile);
      expect(parserCallCount).to.equal(1);

      // Wait and modify file
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFileSync(modelFile, 'v2');

      const entry = await cache.getMetadata(modelFile);
      expect(parserCallCount).to.equal(2);
      expect(entry.architecture).to.equal('v2');
    });

    it('should throw when model file does not exist', async () => {
      const cache = new GGUFMetadataCache(cacheFile);
      try {
        await cache.getMetadata('/nonexistent/model.gguf');
        expect.fail('Expected error');
      } catch (err) {
        expect(err.message).to.include('not found');
      }
    });

    it('should fallback to filename quantization when parser throws', async () => {
      const modelFile = path.join(tmpDir, 'llama-Q5_K_M.gguf');
      fs.writeFileSync(modelFile, 'invalid-gguf-data');

      const cache = new GGUFMetadataCache(cacheFile, {
        parser: () => {
          throw new Error('Parse error');
        },
      });

      const entry = await cache.getMetadata(modelFile);
      expect(entry.quantization).to.equal('Q5_K_M');
      expect(entry.architecture).to.be.null;
    });
  });

  describe('invalidate / clear', () => {
    it('should remove a single entry with invalidate', async () => {
      const cache = new GGUFMetadataCache(cacheFile);
      cache.entries.set('/a.gguf', { filePath: '/a.gguf', mtime: 1 });
      cache.entries.set('/b.gguf', { filePath: '/b.gguf', mtime: 2 });
      cache.dirty = false;

      cache.invalidate('/a.gguf');
      expect(cache.entries.size).to.equal(1);
      expect(cache.dirty).to.be.true;
    });

    it('should remove all entries with clear', () => {
      const cache = new GGUFMetadataCache(cacheFile);
      cache.entries.set('/a.gguf', { filePath: '/a.gguf', mtime: 1 });
      cache.dirty = false;

      cache.clear();
      expect(cache.entries.size).to.equal(0);
      expect(cache.dirty).to.be.true;
    });
  });
});

// ---------------------------------------------------------------------------
// Parser tests with synthetic GGUF files
// ---------------------------------------------------------------------------

describe('parseGGUFMetadata', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'gguf-parser-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function writeString(buffer, offset, str) {
    const len = Buffer.byteLength(str, 'utf8');
    buffer.writeBigUInt64LE(BigInt(len), offset);
    offset += 8;
    buffer.write(str, offset, len, 'utf8');
    return offset + len;
  }

  function writeValue(buffer, offset, type, value) {
    switch (type) {
      case GGUF_TYPES.STRING:
        return writeString(buffer, offset, value);
      case GGUF_TYPES.UINT32:
        buffer.writeUInt32LE(value, offset);
        return offset + 4;
      case GGUF_TYPES.UINT64:
        buffer.writeBigUInt64LE(BigInt(value), offset);
        return offset + 8;
      default:
        throw new Error(`Unsupported test type ${type}`);
    }
  }

  function createFakeGGUF(metadata) {
    const filePath = path.join(tmpDir, 'fake.gguf');
    // Estimate size
    let size = 24; // header prefix
    for (const [key, { type, value }] of Object.entries(metadata)) {
      size += 8 + Buffer.byteLength(key, 'utf8') + 4;
      if (type === GGUF_TYPES.STRING) {
        size += 8 + Buffer.byteLength(value, 'utf8');
      } else if (type === GGUF_TYPES.UINT32) {
        size += 4;
      } else if (type === GGUF_TYPES.UINT64) {
        size += 8;
      }
    }

    const buf = Buffer.alloc(size);
    let offset = 0;

    // Magic
    buf.write('GGUF', offset, 4, 'utf8');
    offset += 4;

    // Version
    buf.writeUInt32LE(3, offset);
    offset += 4;

    // Tensor count
    buf.writeBigUInt64LE(BigInt(0), offset);
    offset += 8;

    // Metadata KV count
    const keys = Object.keys(metadata);
    buf.writeBigUInt64LE(BigInt(keys.length), offset);
    offset += 8;

    for (const key of keys) {
      const { type, value } = metadata[key];
      offset = writeString(buf, offset, key);
      buf.writeUInt32LE(type, offset);
      offset += 4;
      offset = writeValue(buf, offset, type, value);
    }

    fs.writeFileSync(filePath, buf);
    return filePath;
  }

  it('should parse architecture and quantization', () => {
    const file = createFakeGGUF({
      'general.architecture': { type: GGUF_TYPES.STRING, value: 'llama' },
      'general.file_type': { type: GGUF_TYPES.UINT32, value: 12 }, // Q4_K
      'llama.block_count': { type: GGUF_TYPES.UINT32, value: 32 },
      'llama.context_length': { type: GGUF_TYPES.UINT32, value: 4096 },
      'general.parameter_count': { type: GGUF_TYPES.UINT64, value: 7000000000 },
    });

    const meta = parseGGUFMetadata(file);
    expect(meta.architecture).to.equal('llama');
    expect(meta.quantization).to.equal('Q4_K');
    expect(meta.layerCount).to.equal(32);
    expect(meta.contextLength).to.equal(4096);
    expect(meta.parameterCount).to.equal(7000000000);
    expect(meta.fileSizeMB).to.be.a('number');
  });

  it('should parse alternative key names', () => {
    const file = createFakeGGUF({
      'llama.num_hidden_layers': { type: GGUF_TYPES.UINT32, value: 40 },
      'context_length': { type: GGUF_TYPES.UINT32, value: 8192 },
      'general.params': { type: GGUF_TYPES.UINT64, value: 13000000000 },
    });

    const meta = parseGGUFMetadata(file);
    expect(meta.layerCount).to.equal(40);
    expect(meta.contextLength).to.equal(8192);
    expect(meta.parameterCount).to.equal(13000000000);
  });

  it('should throw on invalid magic', () => {
    const file = path.join(tmpDir, 'bad.gguf');
    const buf = Buffer.alloc(24);
    buf.write('BAD!', 0, 4, 'utf8');
    fs.writeFileSync(file, buf);
    expect(() => parseGGUFMetadata(file)).to.throw('Invalid GGUF magic');
  });
});
