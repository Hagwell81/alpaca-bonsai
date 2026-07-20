/* eslint-env node */
/**
 * Benchmarks for RequestBatcher throughput improvements
 *
 * Run with: node desktop/tests/request-batcher-benchmark.js
 */

const http = require('http');
const { RequestBatcher } = require('../request-batcher');

/**
 * Creates a mock embedding API server with configurable latency
 */
function createMockEmbeddingServer(port = 13450, latencyMs = 10) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/embeddings') {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          // Simulate API latency
          setTimeout(() => {
            try {
              const data = JSON.parse(body);
              const inputs = Array.isArray(data.input) ? data.input : [data.input];
              
              // Generate mock embeddings
              const embeddings = inputs.map((input, index) => ({
                object: 'embedding',
                embedding: Array(384).fill(0).map((_, i) => Math.sin(index + i / 100)),
                index: index
              }));
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                object: 'list',
                data: embeddings,
                model: 'mock-embedding-model',
                usage: {
                  prompt_tokens: inputs.length,
                  total_tokens: inputs.length
                }
              }));
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          }, latencyMs);
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    server.listen(port, () => {
      resolve(server);
    });
  });
}

/**
 * Benchmark: Batched vs non-batched requests
 */
async function benchmarkBatchedVsNonBatched() {
  console.log('\n' + '='.repeat(70));
  console.log('Benchmark: Batched vs Non-Batched Requests');
  console.log('='.repeat(70));
  
  const server = await createMockEmbeddingServer(13450, 10);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13450,
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        };
        
        const req = http.request(options, (res) => {
          let body = '';
          
          res.on('data', chunk => {
            body += chunk.toString();
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(body);
              resolve(response.data);
            } catch (error) {
              reject(error);
            }
          });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };
    
    const requestCounts = [10, 50, 100];
    
    for (const count of requestCounts) {
      console.log(`\nTesting with ${count} requests:`);
      
      // Batched approach
      const batcher = new RequestBatcher(50, 100, apiCallFn);
      
      const batchedStartTime = Date.now();
      const batchedPromises = [];
      for (let i = 0; i < count; i++) {
        batchedPromises.push(batcher.addRequest(`input ${i}`));
      }
      
      await Promise.all(batchedPromises);
      const batchedTime = Date.now() - batchedStartTime;
      
      const stats = batcher.getStats();
      
      // Non-batched approach (simulated)
      // Each request would take ~10ms (API latency) + overhead
      const estimatedNonBatchedTime = count * 10 + (count * 2); // 2ms overhead per request
      
      const improvement = ((estimatedNonBatchedTime - batchedTime) / estimatedNonBatchedTime * 100).toFixed(2);
      
      console.log(`  Batched time: ${batchedTime}ms`);
      console.log(`  Estimated non-batched time: ${estimatedNonBatchedTime}ms`);
      console.log(`  Improvement: ${improvement}%`);
      console.log(`  API calls: ${stats.totalBatches} (vs ${count} without batching)`);
      console.log(`  API call reduction: ${stats.apiCallReduction}`);
      console.log(`  Avg batch size: ${stats.avgBatchSize.toFixed(2)}`);
      
      batcher.destroy();
    }
  } finally {
    server.close();
  }
}

/**
 * Benchmark: Different batch window sizes
 */
async function benchmarkBatchWindowSizes() {
  console.log('\n' + '='.repeat(70));
  console.log('Benchmark: Different Batch Window Sizes');
  console.log('='.repeat(70));
  
  const server = await createMockEmbeddingServer(13451, 5);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13451,
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        };
        
        const req = http.request(options, (res) => {
          let body = '';
          
          res.on('data', chunk => {
            body += chunk.toString();
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(body);
              resolve(response.data);
            } catch (error) {
              reject(error);
            }
          });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };
    
    const windowSizes = [10, 50, 100, 200];
    
    console.log('\nProcessing 50 requests with different batch windows:');
    
    for (const windowSize of windowSizes) {
      const batcher = new RequestBatcher(windowSize, 100, apiCallFn);
      
      const startTime = Date.now();
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(batcher.addRequest(`input ${i}`));
      }
      
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      const stats = batcher.getStats();
      
      console.log(`  Window ${windowSize}ms: ${totalTime}ms total, ${stats.totalBatches} batches, avg batch size ${stats.avgBatchSize.toFixed(2)}`);
      
      batcher.destroy();
    }
  } finally {
    server.close();
  }
}

/**
 * Benchmark: Different batch size limits
 */
async function benchmarkBatchSizeLimits() {
  console.log('\n' + '='.repeat(70));
  console.log('Benchmark: Different Batch Size Limits');
  console.log('='.repeat(70));
  
  const server = await createMockEmbeddingServer(13452, 5);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13452,
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        };
        
        const req = http.request(options, (res) => {
          let body = '';
          
          res.on('data', chunk => {
            body += chunk.toString();
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(body);
              resolve(response.data);
            } catch (error) {
              reject(error);
            }
          });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };
    
    const batchSizeLimits = [10, 25, 50, 100];
    
    console.log('\nProcessing 100 requests with different batch size limits:');
    
    for (const batchSizeLimit of batchSizeLimits) {
      const batcher = new RequestBatcher(50, batchSizeLimit, apiCallFn);
      
      const startTime = Date.now();
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(batcher.addRequest(`input ${i}`));
      }
      
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      const stats = batcher.getStats();
      
      console.log(`  Limit ${batchSizeLimit}: ${totalTime}ms total, ${stats.totalBatches} batches, avg batch size ${stats.avgBatchSize.toFixed(2)}`);
      
      batcher.destroy();
    }
  } finally {
    server.close();
  }
}

/**
 * Benchmark: Throughput under high concurrency
 */
async function benchmarkHighConcurrency() {
  console.log('\n' + '='.repeat(70));
  console.log('Benchmark: High Concurrency Throughput');
  console.log('='.repeat(70));
  
  const server = await createMockEmbeddingServer(13453, 10);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13453,
          path: '/v1/embeddings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        };
        
        const req = http.request(options, (res) => {
          let body = '';
          
          res.on('data', chunk => {
            body += chunk.toString();
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(body);
              resolve(response.data);
            } catch (error) {
              reject(error);
            }
          });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };
    
    const batcher = new RequestBatcher(50, 100, apiCallFn);
    
    console.log('\nProcessing 500 requests with batching:');
    
    const startTime = Date.now();
    const promises = [];
    for (let i = 0; i < 500; i++) {
      promises.push(batcher.addRequest(`input ${i}`));
    }
    
    await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    
    const stats = batcher.getStats();
    
    const throughput = (500 / (totalTime / 1000)).toFixed(2);
    const estimatedNonBatchedTime = 500 * 10 + (500 * 2); // 10ms API latency + 2ms overhead
    const improvement = ((estimatedNonBatchedTime - totalTime) / estimatedNonBatchedTime * 100).toFixed(2);
    
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Throughput: ${throughput} requests/sec`);
    console.log(`  API calls: ${stats.totalBatches} (vs 500 without batching)`);
    console.log(`  API call reduction: ${stats.apiCallReduction}`);
    console.log(`  Estimated improvement: ${improvement}%`);
    console.log(`  Avg batch size: ${stats.avgBatchSize.toFixed(2)}`);
    console.log(`  Min batch size: ${stats.minBatchSize}`);
    console.log(`  Max batch size: ${stats.maxBatchSize}`);
    
    batcher.destroy();
  } finally {
    server.close();
  }
}

/**
 * Run all benchmarks
 */
async function runAllBenchmarks() {
  console.log('\n' + '='.repeat(70));
  console.log('RequestBatcher Throughput Benchmarks');
  console.log('='.repeat(70));
  
  try {
    await benchmarkBatchedVsNonBatched();
    await benchmarkBatchWindowSizes();
    await benchmarkBatchSizeLimits();
    await benchmarkHighConcurrency();
    
    console.log('\n' + '='.repeat(70));
    console.log('✓ All benchmarks completed!');
    console.log('='.repeat(70) + '\n');
    process.exit(0);
  } catch (error) {
    console.error('✗ Benchmark failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run benchmarks
runAllBenchmarks();
