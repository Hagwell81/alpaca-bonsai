/* eslint-env node */
/**
 * Request Batcher Module
 * 
 * Provides request batching for embedding requests to improve throughput by combining
 * multiple embedding requests into a single API call.
 * 
 * @module request-batcher
 */

const EventEmitter = require('events');

/**
 * Request Batcher implementation that coalesces multiple embedding requests
 * into a single API call within a configurable time window.
 * 
 * Batching reduces API calls by 10-100x for high-concurrency scenarios while
 * maintaining minimal latency increase (50ms batch window).
 */
class RequestBatcher extends EventEmitter {
  /**
   * Creates a new RequestBatcher instance.
   * 
   * @param {number} batchWindowMs - Time window for batching in milliseconds (default: 50, range: 10-5000)
   * @param {number} maxBatchSize - Maximum requests per batch (default: 100, range: 1-10000)
   * @param {Function} apiCallFn - Function to call with batched inputs: async (inputs) => embeddings[]
   */
  constructor(batchWindowMs = 50, maxBatchSize = 100, apiCallFn = null) {
    super();
    
    // Validate parameters
    if (batchWindowMs < 10 || batchWindowMs > 5000) {
      throw new Error('batchWindowMs must be between 10 and 5000');
    }
    if (maxBatchSize < 1 || maxBatchSize > 10000) {
      throw new Error('maxBatchSize must be between 1 and 10000');
    }
    
    this.batchWindowMs = batchWindowMs;
    this.maxBatchSize = maxBatchSize;
    this.apiCallFn = apiCallFn;
    
    // Current batch queue
    this.currentBatch = [];
    this.batchTimer = null;
    this.batchStartTime = null;
    
    // Statistics
    this.stats = {
      totalBatches: 0,
      totalRequests: 0,
      totalErrors: 0,
      avgBatchSize: 0,
      minBatchSize: Infinity,
      maxBatchSize: 0,
      totalBatchTime: 0,
      avgBatchTime: 0,
      createdAt: Date.now()
    };
    
    // Track batch sizes for statistics
    this.batchSizes = [];
    this.batchTimes = [];
    this.maxHistorySize = 100;
  }

  /**
   * Adds a request to the batch queue.
   * 
   * @param {string|string[]} input - The embedding input(s)
   * @returns {Promise<Object|Object[]>} Promise that resolves with embedding(s)
   */
  async addRequest(input) {
    return new Promise((resolve, reject) => {
      const requestId = this.currentBatch.length;
      const request = {
        id: requestId,
        input,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };
      
      this.currentBatch.push(request);
      this.stats.totalRequests++;
      
      // If batch is full, send immediately
      if (this.currentBatch.length >= this.maxBatchSize) {
        this.flushBatch();
      } else if (this.currentBatch.length === 1) {
        // First request in batch, start timer
        this.startBatchTimer();
      }
    });
  }

  /**
   * Starts the batch timer to flush after the window expires.
   * 
   * @private
   */
  startBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    this.batchStartTime = Date.now();
    this.batchTimer = setTimeout(() => {
      this.flushBatch();
    }, this.batchWindowMs);
  }

  /**
   * Flushes the current batch by making the API call and resolving individual requests.
   * 
   * @private
   */
  async flushBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.currentBatch.length === 0) {
      return;
    }
    
    const batch = this.currentBatch;
    this.currentBatch = [];
    
    const batchStartTime = Date.now();
    
    try {
      // Extract inputs from batch
      const inputs = batch.map(req => req.input);
      
      // Call the API with batched inputs
      if (!this.apiCallFn) {
        throw new Error('apiCallFn not configured');
      }
      
      const embeddings = await this.apiCallFn(inputs);
      
      // Validate response
      if (!Array.isArray(embeddings)) {
        throw new Error('API response must be an array of embeddings');
      }
      
      if (embeddings.length !== batch.length) {
        throw new Error(`Response count (${embeddings.length}) does not match request count (${batch.length})`);
      }
      
      // Resolve each request with its corresponding embedding
      batch.forEach((request, index) => {
        request.resolve(embeddings[index]);
      });
      
      // Record statistics
      this.recordBatchSuccess(batch.length, Date.now() - batchStartTime);
      
      this.emit('batch-complete', {
        batchSize: batch.length,
        duration: Date.now() - batchStartTime,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.stats.totalErrors++;
      
      // Reject all requests in batch with the same error
      batch.forEach((request) => {
        request.reject(error);
      });
      
      this.emit('batch-error', {
        batchSize: batch.length,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Records successful batch statistics.
   * 
   * @private
   * @param {number} batchSize - Number of requests in batch
   * @param {number} batchTime - Time taken to process batch in milliseconds
   */
  recordBatchSuccess(batchSize, batchTime) {
    this.stats.totalBatches++;
    this.stats.totalBatchTime += batchTime;
    this.stats.avgBatchTime = this.stats.totalBatchTime / this.stats.totalBatches;
    
    // Update batch size statistics
    this.batchSizes.push(batchSize);
    if (this.batchSizes.length > this.maxHistorySize) {
      this.batchSizes.shift();
    }
    
    this.stats.minBatchSize = Math.min(this.stats.minBatchSize, batchSize);
    this.stats.maxBatchSize = Math.max(this.stats.maxBatchSize, batchSize);
    this.stats.avgBatchSize = this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length;
    
    // Track batch times
    this.batchTimes.push(batchTime);
    if (this.batchTimes.length > this.maxHistorySize) {
      this.batchTimes.shift();
    }
  }

  /**
   * Gets current batch statistics.
   * 
   * @returns {Object} Batch statistics including totals, averages, and efficiency metrics
   */
  getStats() {
    const sorted = [...this.batchTimes].sort((a, b) => a - b);
    
    return {
      totalBatches: this.stats.totalBatches,
      totalRequests: this.stats.totalRequests,
      totalErrors: this.stats.totalErrors,
      avgBatchSize: this.stats.avgBatchSize,
      minBatchSize: this.stats.minBatchSize === Infinity ? 0 : this.stats.minBatchSize,
      maxBatchSize: this.stats.maxBatchSize,
      totalBatchTime: this.stats.totalBatchTime,
      avgBatchTime: this.stats.avgBatchTime,
      batchTimeP50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      batchTimeP95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      batchTimeP99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      currentBatchSize: this.currentBatch.length,
      batchWindowMs: this.batchWindowMs,
      maxBatchSizeLimit: this.maxBatchSize,
      uptime: Date.now() - this.stats.createdAt,
      // Efficiency metric: reduction in API calls
      apiCallReduction: this.stats.totalBatches > 0 
        ? ((this.stats.totalRequests - this.stats.totalBatches) / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Manually flushes the current batch immediately.
   * Useful for graceful shutdown or testing.
   * 
   * @returns {Promise<void>}
   */
  async flush() {
    await this.flushBatch();
  }

  /**
   * Clears all pending requests with an error.
   * 
   * @param {Error} error - Error to reject all pending requests with
   */
  clearPending(error = new Error('Batcher cleared')) {
    this.currentBatch.forEach((request) => {
      request.reject(error);
    });
    this.currentBatch = [];
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Resets all statistics.
   */
  resetStats() {
    this.stats = {
      totalBatches: 0,
      totalRequests: 0,
      totalErrors: 0,
      avgBatchSize: 0,
      minBatchSize: Infinity,
      maxBatchSize: 0,
      totalBatchTime: 0,
      avgBatchTime: 0,
      createdAt: Date.now()
    };
    this.batchSizes = [];
    this.batchTimes = [];
  }

  /**
   * Destroys the batcher and cleans up resources.
   * Should be called on application shutdown.
   */
  destroy() {
    this.clearPending();
    this.removeAllListeners();
  }
}

module.exports = { RequestBatcher };
