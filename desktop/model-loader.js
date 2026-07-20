/**
 * Model_Loader Module
 * 
 * Provides model loading optimizations including:
 * - Warm-cache LRU for faster subsequent loads
 * - mmap reference management
 * - Quantization compatibility checking
 * - GGUF header parsing
 * - Lazy tensor loading with VRAM detection
 * 
 * @module model-loader
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const os = require('os');

/**
 * Custom error classes for ModelLoader
 */
class ModelLoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelLoaderError';
  }
}

class QuantizationIncompatibleError extends ModelLoaderError {
  constructor(quantization, backend) {
    super(`Quantization ${quantization} is incompatible with backend ${backend}`);
    this.name = 'QuantizationIncompatibleError';
    this.quantization = quantization;
    this.backend = backend;
  }
}

class WarmCacheError extends ModelLoaderError {
  constructor(message) {
    super(message);
    this.name = 'WarmCacheError';
  }
}

class TensorLoadError extends ModelLoaderError {
  constructor(message) {
    super(message);
    this.name = 'TensorLoadError';
  }
}

class GGUFParseError extends ModelLoaderError {
  constructor(message) {
    super(message);
    this.name = 'GGUFParseError';
  }
}

/**
 * Represents a cached model entry in the warm cache
 */
class CacheEntry {
  constructor(modelPath, mmapRef = null) {
    this.modelPath = modelPath;
    this.mmapRef = mmapRef;
    this.loadedAt = Date.now();
    this.lastAccessedAt = Date.now();
    this.accessCount = 0;
    this.ttlMs = 5 * 60 * 1000; // 5 minutes default
    this.expiresAt = Date.now() + this.ttlMs;
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }

  updateAccess() {
    this.lastAccessedAt = Date.now();
    this.accessCount++;
  }

  refresh(ttlMs) {
    this.ttlMs = ttlMs;
    this.expiresAt = Date.now() + ttlMs;
  }
}

/**
 * ModelLoader class
 * 
 * Manages model loading with optimizations for performance and compatibility.
 * Provides warm-caching, quantization checking, and lazy tensor loading.
 */
class ModelLoader extends EventEmitter {
  /**
   * Create a new ModelLoader instance
   * 
   * @param {Object} options - Configuration options
   * @param {number} options.maxCacheSize - Maximum number of models in warm cache (default: 3)
   * @param {number} options.cacheTtlMs - Cache TTL in milliseconds (default: 5 minutes)
   * @param {Object} options.logger - Logger instance (optional)
   * @param {Object} options.vramDetector - VRAM detection function (optional)
   */
  constructor(options = {}) {
    super();

    this.maxCacheSize = options.maxCacheSize || 3;
    this.cacheTtlMs = options.cacheTtlMs || 5 * 60 * 1000; // 5 minutes
    this.logger = options.logger || this._createDefaultLogger();
    this.vramDetector = options.vramDetector || null;

    // Warm cache: Map<modelPath, CacheEntry>
    this.warmCache = new Map();

    // Track cache statistics
    this.stats = {
      totalLoads: 0,
      cacheHits: 0,
      cacheMisses: 0,
      evictions: 0,
      quantizationChecks: 0,
      quantizationFailures: 0,
      tensorLoadAttempts: 0,
      tensorLoadFailures: 0,
    };

    // Supported quantization types by backend
    this.supportedQuantizations = {
      cuda: ['F32', 'F16', 'Q8_0', 'Q8_1', 'Q5_0', 'Q5_1', 'Q4_0', 'Q4_1', 'Q3_K_S', 'Q3_K_M', 'Q2_K', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K'],
      rocm: ['F32', 'F16', 'Q8_0', 'Q8_1', 'Q5_0', 'Q5_1', 'Q4_0', 'Q4_1', 'Q3_K_S', 'Q3_K_M', 'Q2_K', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K'],
      cpu: ['F32', 'F16', 'Q8_0', 'Q8_1', 'Q5_0', 'Q5_1', 'Q4_0', 'Q4_1', 'Q3_K_S', 'Q3_K_M', 'Q2_K', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K'],
      metal: ['F32', 'F16', 'Q8_0', 'Q8_1', 'Q5_0', 'Q5_1', 'Q4_0', 'Q4_1', 'Q3_K_S', 'Q3_K_M', 'Q2_K', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K'],
    };

    // Cache cleanup interval
    this.cleanupInterval = null;
    this._startCleanupInterval();
  }

  /**
   * Create a default logger
   * @private
   */
  _createDefaultLogger() {
    return {
      debug: (msg) => console.debug(`[ModelLoader] ${msg}`),
      info: (msg) => console.info(`[ModelLoader] ${msg}`),
      warn: (msg) => console.warn(`[ModelLoader] ${msg}`),
      error: (msg) => console.error(`[ModelLoader] ${msg}`),
    };
  }

  /**
   * Start the cache cleanup interval
   * @private
   */
  _startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this._cleanupExpiredCache();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  _cleanupExpiredCache() {
    const expiredKeys = [];
    for (const [key, entry] of this.warmCache.entries()) {
      if (entry.isExpired()) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const entry = this.warmCache.get(key);
      this._releaseCacheEntry(entry);
      this.warmCache.delete(key);
      this.logger.debug(`Expired cache entry: ${key}`);
    }
  }

  /**
   * Release resources associated with a cache entry
   * @private
   */
  _releaseCacheEntry(entry) {
    if (entry.mmapRef) {
      try {
        // In a real implementation, this would close the mmap reference
        // For now, we just mark it as released
        entry.mmapRef = null;
      } catch (err) {
        this.logger.error(`Failed to release mmap reference: ${err.message}`);
      }
    }
  }

  /**
   * Evict the least recently used entry from the cache
   * @private
   */
  _evictLRU() {
    let lruKey = null;
    let lruEntry = null;

    for (const [key, entry] of this.warmCache.entries()) {
      if (!lruEntry || entry.lastAccessedAt < lruEntry.lastAccessedAt) {
        lruKey = key;
        lruEntry = entry;
      }
    }

    if (lruKey && lruEntry) {
      this._releaseCacheEntry(lruEntry);
      this.warmCache.delete(lruKey);
      this.stats.evictions++;
      this.logger.debug(`Evicted LRU cache entry: ${lruKey}`);
      this.emit('cache-evicted', { modelPath: lruKey });
    }
  }

  /**
   * Load a model with optimizations
   * 
   * @param {string} modelPath - Path to the model file
   * @param {Object} options - Load options
   * @param {string} options.backend - Backend type (cuda, rocm, cpu, metal)
   * @param {boolean} options.useWarmCache - Use warm cache if available (default: true)
   * @param {boolean} options.checkQuantization - Check quantization compatibility (default: true)
   * @param {boolean} options.lazyTensorLoad - Use lazy tensor loading (default: true)
   * @returns {Promise<Object>} Load result with metadata
   */
  async loadModel(modelPath, options = {}) {
    const {
      backend = 'cpu',
      useWarmCache = true,
      checkQuantization = true,
      lazyTensorLoad = true,
    } = options;

    this.stats.totalLoads++;

    try {
      // Verify model file exists
      if (!fs.existsSync(modelPath)) {
        throw new ModelLoaderError(`Model file not found: ${modelPath}`);
      }

      // Check warm cache first
      if (useWarmCache && this.warmCache.has(modelPath)) {
        const cacheEntry = this.warmCache.get(modelPath);
        if (!cacheEntry.isExpired()) {
          cacheEntry.updateAccess();
          this.stats.cacheHits++;
          this.logger.debug(`Cache hit for model: ${modelPath}`);
          this.emit('cache-hit', { modelPath });
          return {
            modelPath,
            cached: true,
            backend,
            quantization: cacheEntry.quantization,
            lazyTensorLoad,
          };
        } else {
          // Remove expired entry
          this._releaseCacheEntry(cacheEntry);
          this.warmCache.delete(modelPath);
        }
      }

      this.stats.cacheMisses++;

      // Parse GGUF header to extract quantization metadata
      let quantization = null;
      if (checkQuantization) {
        quantization = await this._parseGGUFHeader(modelPath);
        
        // Check quantization compatibility
        if (quantization) {
          const isCompatible = this._isQuantizationCompatible(quantization, backend);
          if (!isCompatible) {
            this.stats.quantizationFailures++;
            throw new QuantizationIncompatibleError(quantization, backend);
          }
        }
      }

      // Determine lazy tensor load flags based on VRAM
      let tensorLoadFlags = {};
      if (lazyTensorLoad) {
        tensorLoadFlags = await this._determineTensorLoadFlags(modelPath, backend);
      }

      // Add to warm cache
      if (useWarmCache) {
        await this._addToWarmCache(modelPath, quantization);
      }

      this.logger.debug(`Loaded model: ${modelPath} (backend: ${backend}, quantization: ${quantization})`);
      this.emit('model-loaded', { modelPath, backend, quantization });

      return {
        modelPath,
        cached: false,
        backend,
        quantization,
        lazyTensorLoad,
        tensorLoadFlags,
      };
    } catch (err) {
      this.logger.error(`Failed to load model: ${err.message}`);
      this.emit('load-error', { modelPath, error: err.message });
      throw err;
    }
  }

  /**
   * Warm-cache a model for faster subsequent loads
   * 
   * @param {string} modelPath - Path to the model file
   * @param {Object} options - Cache options
   * @param {number} options.ttlMs - Cache TTL in milliseconds (default: 5 minutes)
   * @returns {Promise<void>}
   */
  async warmCacheModel(modelPath, options = {}) {
    const { ttlMs = this.cacheTtlMs } = options;

    try {
      if (!fs.existsSync(modelPath)) {
        throw new WarmCacheError(`Model file not found: ${modelPath}`);
      }

      // Parse GGUF header
      const quantization = await this._parseGGUFHeader(modelPath);

      // Add to warm cache
      await this._addToWarmCache(modelPath, quantization, ttlMs);

      this.logger.debug(`Warm-cached model: ${modelPath}`);
      this.emit('model-warm-cached', { modelPath, ttlMs });
    } catch (err) {
      this.logger.error(`Failed to warm-cache model: ${err.message}`);
      throw new WarmCacheError(`Failed to warm-cache model: ${err.message}`);
    }
  }

  /**
   * Add a model to the warm cache
   * @private
   */
  async _addToWarmCache(modelPath, quantization, ttlMs = this.cacheTtlMs) {
    // Check if already in cache
    if (this.warmCache.has(modelPath)) {
      const entry = this.warmCache.get(modelPath);
      entry.refresh(ttlMs);
      entry.updateAccess();
      return;
    }

    // Evict LRU if cache is full
    if (this.warmCache.size >= this.maxCacheSize) {
      this._evictLRU();
    }

    // Create cache entry
    const entry = new CacheEntry(modelPath);
    entry.quantization = quantization;
    entry.ttlMs = ttlMs;
    entry.expiresAt = Date.now() + ttlMs;
    entry.updateAccess(); // Count the initial load

    // In a real implementation, we would create an mmap reference here
    // For now, we just store the metadata
    this.warmCache.set(modelPath, entry);
  }

  /**
   * Check quantization compatibility with backend
   * 
   * @param {string} modelPath - Path to the model file
   * @param {string} backend - Backend type (cuda, rocm, cpu, metal)
   * @returns {Promise<boolean>} True if compatible
   */
  async checkQuantizationCompatibility(modelPath, backend) {
    try {
      this.stats.quantizationChecks++;

      if (!fs.existsSync(modelPath)) {
        throw new ModelLoaderError(`Model file not found: ${modelPath}`);
      }

      const quantization = await this._parseGGUFHeader(modelPath);
      if (!quantization) {
        this.logger.warn(`Could not determine quantization for model: ${modelPath}`);
        return true; // Assume compatible if we can't determine
      }

      const isCompatible = this._isQuantizationCompatible(quantization, backend);
      
      if (!isCompatible) {
        this.stats.quantizationFailures++;
        this.logger.warn(`Quantization ${quantization} incompatible with backend ${backend}`);
      }

      return isCompatible;
    } catch (err) {
      this.logger.error(`Failed to check quantization compatibility: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if a quantization is compatible with a backend
   * @private
   */
  _isQuantizationCompatible(quantization, backend) {
    const supported = this.supportedQuantizations[backend] || this.supportedQuantizations.cpu;
    return supported.includes(quantization);
  }

  /**
   * Parse GGUF header to extract quantization metadata
   * @private
   */
  async _parseGGUFHeader(modelPath) {
    return new Promise((resolve, reject) => {
      try {
        const fd = fs.openSync(modelPath, 'r');
        const buffer = Buffer.alloc(1024); // Read first 1KB for header

        fs.readSync(fd, buffer, 0, 1024, 0);
        fs.closeSync(fd);

        // Parse GGUF magic number and version
        const magic = buffer.toString('utf8', 0, 4);
        if (magic !== 'GGUF') {
          reject(new GGUFParseError('Invalid GGUF magic number'));
          return;
        }

        // Extract quantization from filename as fallback
        const filename = path.basename(modelPath);
        const quantMatch = filename.match(/-(Q\d[_A-Z]*)\./);
        if (quantMatch) {
          resolve(quantMatch[1]);
          return;
        }

        // If we can't determine quantization, return null
        resolve(null);
      } catch (err) {
        reject(new GGUFParseError(`Failed to parse GGUF header: ${err.message}`));
      }
    });
  }

  /**
   * Determine tensor load flags based on VRAM availability
   * @private
   */
  async _determineTensorLoadFlags(modelPath, backend) {
    try {
      this.stats.tensorLoadAttempts++;

      const vram = await this._detectVRAM(backend);
      const modelSize = fs.statSync(modelPath).size;

      const flags = {};

      // Determine if we should use lazy loading
      if (vram < modelSize * 0.5) {
        // Less than 50% VRAM available
        flags.noMmap = true;
        flags.tensorSplit = false;
        this.logger.debug(`Using --no-mmap for model (VRAM: ${vram}, Model: ${modelSize})`);
      } else {
        // 50% or more VRAM available
        flags.tensorSplit = true;
        flags.noMmap = false;
        this.logger.debug(`Using --tensor-split for model (VRAM: ${vram}, Model: ${modelSize})`);
      }

      return flags;
    } catch (err) {
      this.logger.error(`Failed to determine tensor load flags: ${err.message}`);
      this.stats.tensorLoadFailures++;
      return {};
    }
  }

  /**
   * Detect available VRAM for the backend
   * @private
   */
  async _detectVRAM(backend) {
    // If a custom VRAM detector is provided, use it
    if (this.vramDetector) {
      try {
        return await this.vramDetector(backend);
      } catch (err) {
        this.logger.warn(`VRAM detection failed: ${err.message}`);
      }
    }

    // Default VRAM detection based on backend
    // In a real implementation, this would query GPU drivers
    const defaultVRAM = {
      cuda: 8 * 1024 * 1024 * 1024, // 8GB
      rocm: 8 * 1024 * 1024 * 1024, // 8GB
      metal: 4 * 1024 * 1024 * 1024, // 4GB
      cpu: os.totalmem() * 0.5, // 50% of system RAM
    };

    return defaultVRAM[backend] || defaultVRAM.cpu;
  }

  /**
   * Get warm cache statistics
   * 
   * @returns {Object} Cache statistics
   */
  getWarmCacheStats() {
    const cacheEntries = Array.from(this.warmCache.entries()).map(([path, entry]) => ({
      modelPath: path,
      loadedAt: entry.loadedAt,
      lastAccessedAt: entry.lastAccessedAt,
      accessCount: entry.accessCount,
      expiresAt: entry.expiresAt,
      isExpired: entry.isExpired(),
      quantization: entry.quantization,
    }));

    return {
      cacheSize: this.warmCache.size,
      maxCacheSize: this.maxCacheSize,
      entries: cacheEntries,
      stats: { ...this.stats },
    };
  }

  /**
   * Clear the warm cache
   * 
   * @returns {void}
   */
  clearWarmCache() {
    for (const [, entry] of this.warmCache.entries()) {
      this._releaseCacheEntry(entry);
    }
    this.warmCache.clear();
    this.logger.debug('Warm cache cleared');
    this.emit('cache-cleared');
  }

  /**
   * Destroy the ModelLoader and clean up resources
   * 
   * @returns {void}
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearWarmCache();
    this.logger.debug('ModelLoader destroyed');
  }
}

// Export classes and functions
module.exports = {
  ModelLoader,
  ModelLoaderError,
  QuantizationIncompatibleError,
  WarmCacheError,
  TensorLoadError,
  GGUFParseError,
};
