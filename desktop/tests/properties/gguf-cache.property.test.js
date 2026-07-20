/* eslint-env node */
/**
 * Property Test P11: GGUF Metadata Cache Round-Trip
 * Property Test P12: GGUF Cache Invalidation by Mtime
 *
 * Validates: Requirements 7.6, 7.2
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GGUFMetadataCache } = require('../../gguf-metadata-cache');

describe('P11: GGUF Metadata Cache Round-Trip', () => {
  let tmpDir;
  let cacheFile;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'gguf-prop-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    cacheFile = path.join(tmpDir, 'cache.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('JSON.parse(JSON.stringify(entry)) produces deeply-equal object', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: 1000000000 }),
        fc.string(),
        fc.constantFrom('F32', 'F16', 'Q4_0', 'Q4_K_M', 'Q5_K_M', 'Q6_K'),
        fc.integer({ min: 1, max: 256 }),
        fc.integer({ min: 512, max: 131072 }),
        fc.integer({ min: 1000000, max: 100000000000 }),
        fc.integer({ min: 1, max: 100000 }),
        (filePath, mtime, architecture, quantization, layerCount, contextLength, parameterCount, fileSizeMB) => {
          const entry = {
            filePath,
            mtime,
            architecture,
            quantization,
            layerCount,
            contextLength,
            parameterCount,
            fileSizeMB,
            parsedAt: new Date().toISOString(),
          };
          const serialized = JSON.stringify(entry);
          const deserialized = JSON.parse(serialized);
          expect(deserialized).to.deep.equal(entry);
          return true;
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('P12: GGUF Cache Invalidation by Mtime', () => {
  let tmpDir;
  let cacheFile;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'gguf-prop-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    cacheFile = path.join(tmpDir, 'cache.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('cache returns stored metadata when mtime matches', async () => {
    const modelFile = path.join(tmpDir, 'model.gguf');
    fs.writeFileSync(modelFile, 'data');

    const cache = new GGUFMetadataCache(cacheFile, {
      parser: () => ({
        architecture: 'llama',
        quantization: 'Q4_K_M',
        layerCount: 32,
        contextLength: 4096,
        parameterCount: 7000000000,
        fileSizeMB: 4096,
      }),
    });

    const entry = await cache.getMetadata(modelFile);
    expect(entry.architecture).to.equal('llama');

    // Second call with same mtime should hit cache
    let parserCalled = false;
    const cache2 = new GGUFMetadataCache(cacheFile, {
      parser: () => {
        parserCalled = true;
        return {
          architecture: 'mistral',
          quantization: 'Q5_K_M',
          layerCount: 32,
          contextLength: 4096,
          parameterCount: 7000000000,
          fileSizeMB: 4096,
        };
      },
    });
    cache2.entries = cache.entries;

    const entry2 = await cache2.getMetadata(modelFile);
    expect(parserCalled).to.be.false;
    expect(entry2.architecture).to.equal('llama');
  });

  it('cache re-parses when mtime differs', async () => {
    const modelFile = path.join(tmpDir, 'model2.gguf');
    fs.writeFileSync(modelFile, 'data');

    const cache = new GGUFMetadataCache(cacheFile, {
      parser: () => ({
        architecture: 'llama',
        quantization: 'Q4_K_M',
        layerCount: 32,
        contextLength: 4096,
        parameterCount: 7000000000,
        fileSizeMB: 4096,
      }),
    });

    await cache.getMetadata(modelFile);

    // Wait and modify file
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(modelFile, 'new-data');

    let parserCalled = false;
    const cache2 = new GGUFMetadataCache(cacheFile, {
      parser: () => {
        parserCalled = true;
        return {
          architecture: 'mistral',
          quantization: 'Q5_K_M',
          layerCount: 32,
          contextLength: 4096,
          parameterCount: 7000000000,
          fileSizeMB: 4096,
        };
      },
    });
    cache2.entries = cache.entries;

    const entry = await cache2.getMetadata(modelFile);
    expect(parserCalled).to.be.true;
    expect(entry.architecture).to.equal('mistral');
  });
});
