/**
 * GGUF Metadata Cache
 *
 * Persistent cache of parsed GGUF file headers keyed by (filePath, mtime).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// GGUF constants
// ---------------------------------------------------------------------------
const GGUF_TYPES = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
};

const GGUF_QUANT_MAP = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  6: 'Q5_0',
  7: 'Q5_1',
  8: 'Q8_0',
  9: 'Q8_1',
  10: 'Q2_K',
  11: 'Q3_K',
  12: 'Q4_K',
  13: 'Q5_K',
  14: 'Q6_K',
  15: 'IQ2_XXS',
  16: 'IQ2_XS',
  17: 'IQ3_XXS',
  18: 'IQ1_S',
  19: 'IQ4_NL',
  20: 'IQ3_S',
  21: 'IQ4_XS',
  22: 'IQ1_M',
  23: 'IQ2_S',
  24: 'IQ2_M',
  25: 'IQ4_K',
};

// ---------------------------------------------------------------------------
// Low-level GGUF reading helpers
// ---------------------------------------------------------------------------

function readString(buffer, offset) {
  const len = Number(buffer.readBigUInt64LE(offset));
  offset += 8;
  const str = buffer.toString('utf8', offset, offset + len);
  return { value: str, nextOffset: offset + len };
}

function readValue(buffer, offset, type) {
  switch (type) {
    case GGUF_TYPES.UINT8:
      return { value: buffer.readUInt8(offset), nextOffset: offset + 1 };
    case GGUF_TYPES.INT8:
      return { value: buffer.readInt8(offset), nextOffset: offset + 1 };
    case GGUF_TYPES.UINT16:
      return { value: buffer.readUInt16LE(offset), nextOffset: offset + 2 };
    case GGUF_TYPES.INT16:
      return { value: buffer.readInt16LE(offset), nextOffset: offset + 2 };
    case GGUF_TYPES.UINT32:
      return { value: buffer.readUInt32LE(offset), nextOffset: offset + 4 };
    case GGUF_TYPES.INT32:
      return { value: buffer.readInt32LE(offset), nextOffset: offset + 4 };
    case GGUF_TYPES.FLOAT32:
      return { value: buffer.readFloatLE(offset), nextOffset: offset + 4 };
    case GGUF_TYPES.BOOL:
      return { value: buffer.readUInt8(offset) !== 0, nextOffset: offset + 1 };
    case GGUF_TYPES.STRING:
      return readString(buffer, offset);
    case GGUF_TYPES.UINT64:
      return { value: Number(buffer.readBigUInt64LE(offset)), nextOffset: offset + 8 };
    case GGUF_TYPES.INT64:
      return { value: Number(buffer.readBigInt64LE(offset)), nextOffset: offset + 8 };
    case GGUF_TYPES.FLOAT64:
      return { value: buffer.readDoubleLE(offset), nextOffset: offset + 8 };
    case GGUF_TYPES.ARRAY: {
      const elemType = buffer.readUInt32LE(offset);
      offset += 4;
      const count = Number(buffer.readBigUInt64LE(offset));
      offset += 8;
      const arr = [];
      for (let i = 0; i < count; i++) {
        const result = readValue(buffer, offset, elemType);
        arr.push(result.value);
        offset = result.nextOffset;
      }
      return { value: arr, nextOffset: offset };
    }
    default:
      throw new Error(`Unknown GGUF metadata value type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// GGUF metadata parser
// ---------------------------------------------------------------------------

function parseGGUFMetadata(modelPath) {
  const fd = fs.openSync(modelPath, 'r');
  try {
    const HEADER_SIZE = 256 * 1024;
    const buffer = Buffer.alloc(HEADER_SIZE);
    const bytesRead = fs.readSync(fd, buffer, 0, HEADER_SIZE, 0);

    if (bytesRead < 24) {
      throw new Error('File too small for GGUF header');
    }

    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'GGUF') {
      throw new Error(`Invalid GGUF magic: ${magic}`);
    }

    const metadataKVCount = Number(buffer.readBigUInt64LE(16));

    let offset = 24;
    const metadata = {};

    for (let i = 0; i < metadataKVCount; i++) {
      if (offset >= bytesRead) {
        throw new Error('GGUF metadata exceeds read buffer; header too large');
      }

      const keyResult = readString(buffer, offset);
      const key = keyResult.value;
      offset = keyResult.nextOffset;

      if (offset + 4 > bytesRead) {
        throw new Error('GGUF metadata truncated at value type');
      }

      const valueType = buffer.readUInt32LE(offset);
      offset += 4;

      const valueResult = readValue(buffer, offset, valueType);
      metadata[key] = valueResult.value;
      offset = valueResult.nextOffset;
    }

    const architecture = metadata['general.architecture'] || null;
    const fileType = metadata['general.file_type'];

    let quantization = null;
    if (fileType !== undefined && GGUF_QUANT_MAP[fileType] !== undefined) {
      quantization = GGUF_QUANT_MAP[fileType];
    }

    const layerCount =
      metadata['llama.block_count'] ??
      metadata['llama.num_hidden_layers'] ??
      metadata['num_hidden_layers'] ??
      null;

    const contextLength =
      metadata['llama.context_length'] ??
      metadata['context_length'] ??
      null;

    const parameterCount =
      metadata['general.parameter_count'] ??
      metadata['general.params'] ??
      null;

    const stats = fs.statSync(modelPath);
    const fileSizeMB = Math.round(stats.size / (1024 * 1024));

    return {
      architecture,
      quantization,
      layerCount: layerCount != null ? Number(layerCount) : null,
      contextLength: contextLength != null ? Number(contextLength) : null,
      parameterCount: parameterCount != null ? Number(parameterCount) : null,
      fileSizeMB,
    };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Cache class
// ---------------------------------------------------------------------------

class GGUFMetadataCache {
  /**
   * @param {string} cacheFilePath - Absolute path to the JSON cache file
   * @param {Object} [options={}]
   * @param {Function} [options.parser] - override default GGUF parser
   */
  constructor(cacheFilePath, options = {}) {
    this.cacheFilePath = cacheFilePath;
    this.parser = options.parser || parseGGUFMetadata;
    this.entries = new Map();
    this.dirty = false;
  }

  /**
   * Read the JSON cache from disk.
   */
  async load() {
    try {
      const data = await fs.promises.readFile(this.cacheFilePath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
        this.entries = new Map(parsed.entries);
      } else if (parsed && typeof parsed === 'object') {
        this.entries = new Map(Object.entries(parsed));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('Failed to load GGUF metadata cache:', err.message);
      }
      this.entries = new Map();
    }
    this.dirty = false;
  }

  /**
   * Write the JSON cache to disk atomically.
   */
  async save() {
    if (!this.dirty) return;
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: Array.from(this.entries.entries()),
    };
    const tmpPath = this.cacheFilePath + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this.cacheFilePath);
    this.dirty = false;
  }

  /**
   * Get metadata for a model file, using the cache when valid.
   *
   * @param {string} modelPath
   * @returns {Promise<Object>} cache entry
   */
  async getMetadata(modelPath) {
    const stats = await fs.promises.stat(modelPath).catch(() => null);
    if (!stats) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    const mtime = Math.floor(stats.mtimeMs);
    const cached = this.entries.get(modelPath);

    if (cached && cached.mtime === mtime) {
      return cached;
    }

    let metadata;
    try {
      metadata = this.parser(modelPath);
    } catch (err) {
      // Fallback: minimal metadata from file stats and filename
      const quantMatch = path.basename(modelPath).match(/-(Q\d[_A-Z]*)\./);
      metadata = {
        architecture: null,
        quantization: quantMatch ? quantMatch[1] : null,
        layerCount: null,
        contextLength: null,
        parameterCount: null,
        fileSizeMB: Math.round(stats.size / (1024 * 1024)),
      };
    }

    const entry = {
      filePath: modelPath,
      mtime,
      architecture: metadata.architecture,
      quantization: metadata.quantization,
      layerCount: metadata.layerCount,
      contextLength: metadata.contextLength,
      parameterCount: metadata.parameterCount,
      fileSizeMB: metadata.fileSizeMB,
      parsedAt: new Date().toISOString(),
    };

    this.entries.set(modelPath, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * Invalidate a single cached entry.
   * @param {string} modelPath
   */
  invalidate(modelPath) {
    if (this.entries.delete(modelPath)) {
      this.dirty = true;
    }
  }

  /**
   * Clear all cached entries.
   */
  clear() {
    if (this.entries.size > 0) {
      this.entries.clear();
      this.dirty = true;
    }
  }
}

module.exports = { GGUFMetadataCache, parseGGUFMetadata, GGUF_TYPES, GGUF_QUANT_MAP };
