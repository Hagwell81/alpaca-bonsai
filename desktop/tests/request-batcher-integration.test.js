/* eslint-env node */
/**
 * Integration tests for RequestBatcher with mock API server
 *
 * Run with: node desktop/tests/request-batcher-integration.test.js
 */

const assert = require('assert');
const http = require('http');
const { RequestBatcher } = require('../request-batcher');

/**
 * Creates a mock embedding API server
 */
function createMockEmbeddingServer(port = 13439) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/embeddings') {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
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
 * Test: Integration with mock API server
 */
async function testIntegrationWithMockServer() {
  console.log('Testing integration with mock API server...');
  
  const server = await createMockEmbeddingServer(13439);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13439,
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
    
    // Add multiple requests
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(batcher.addRequest(`test input ${i}`));
    }
    
    const results = await Promise.all(promises);
    
    assert.strictEqual(results.length, 5, 'Should have 5 results');
    results.forEach((result, index) => {
      assert.strictEqual(result.index, index, `Result ${index} should have correct index`);
      assert(Array.isArray(result.embedding), `Result ${index} should have embedding array`);
      assert.strictEqual(result.embedding.length, 384, `Result ${index} embedding should have 384 dimensions`);
    });
    
    const stats = batcher.getStats();
    assert.strictEqual(stats.totalBatches, 1, 'Should have 1 batch');
    assert.strictEqual(stats.totalRequests, 5, 'Should have 5 requests');
    
    batcher.destroy();
    console.log('✓ Integration with mock API server test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: Throughput improvement measurement
 */
async function testThroughputImprovement() {
  console.log('Testing throughput improvement...');
  
  const server = await createMockEmbeddingServer(13440);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13440,
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
    
    // Measure batched requests
    const batcher = new RequestBatcher(50, 100, apiCallFn);
    
    const batchedStartTime = Date.now();
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(batcher.addRequest(`test input ${i}`));
    }
    
    await Promise.all(promises);
    const batchedTime = Date.now() - batchedStartTime;
    
    const stats = batcher.getStats();
    
    // Calculate expected improvement
    // Without batching: 20 API calls
    // With batching: 1 API call (all 20 requests in one batch)
    const apiCallReduction = (20 - stats.totalBatches) / 20 * 100;
    
    assert(apiCallReduction > 90, 'Should have > 90% API call reduction');
    assert.strictEqual(stats.totalBatches, 1, 'Should have 1 batch');
    assert.strictEqual(stats.totalRequests, 20, 'Should have 20 requests');
    
    console.log(`  - Batched time: ${batchedTime}ms`);
    console.log(`  - API calls: ${stats.totalBatches} (vs 20 without batching)`);
    console.log(`  - API call reduction: ${apiCallReduction.toFixed(2)}%`);
    
    batcher.destroy();
    console.log('✓ Throughput improvement test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: Multiple concurrent batches
 */
async function testMultipleConcurrentBatches() {
  console.log('Testing multiple concurrent batches...');
  
  const server = await createMockEmbeddingServer(13441);
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13441,
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
    
    const batcher = new RequestBatcher(100, 100, apiCallFn);
    
    // First batch
    const batch1Promises = [];
    for (let i = 0; i < 5; i++) {
      batch1Promises.push(batcher.addRequest(`batch1-input${i}`));
    }
    
    // Wait for first batch to flush
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Second batch
    const batch2Promises = [];
    for (let i = 0; i < 3; i++) {
      batch2Promises.push(batcher.addRequest(`batch2-input${i}`));
    }
    
    const allResults = await Promise.all([...batch1Promises, ...batch2Promises]);
    
    assert.strictEqual(allResults.length, 8, 'Should have 8 results');
    
    const stats = batcher.getStats();
    assert.strictEqual(stats.totalBatches, 2, 'Should have 2 batches');
    assert.strictEqual(stats.totalRequests, 8, 'Should have 8 requests');
    
    batcher.destroy();
    console.log('✓ Multiple concurrent batches test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: Error handling with real API
 */
async function testErrorHandlingWithRealApi() {
  console.log('Testing error handling with real API...');
  
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/embeddings') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  await new Promise(resolve => server.listen(13442, resolve));
  
  try {
    const apiCallFn = async (inputs) => {
      return new Promise((resolve, reject) => {
        const data = JSON.stringify({ input: inputs });
        
        const options = {
          hostname: 'localhost',
          port: 13442,
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
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            } else {
              try {
                const response = JSON.parse(body);
                resolve(response.data);
              } catch (error) {
                reject(error);
              }
            }
          });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };
    
    const batcher = new RequestBatcher(50, 100, apiCallFn);
    
    const promise1 = batcher.addRequest('input 1');
    const promise2 = batcher.addRequest('input 2');
    
    try {
      await Promise.all([promise1, promise2]);
      assert.fail('Should have thrown error');
    } catch (error) {
      assert(error.message.includes('HTTP 500'), 'Should propagate HTTP error');
    }
    
    const stats = batcher.getStats();
    assert.strictEqual(stats.totalErrors, 1, 'Should have 1 error');
    
    batcher.destroy();
    console.log('✓ Error handling with real API test passed');
  } finally {
    server.close();
  }
}

/**
 * Run all integration tests
 */
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('Running RequestBatcher Integration Tests');
  console.log('='.repeat(60));
  
  try {
    await testIntegrationWithMockServer();
    await testThroughputImprovement();
    await testMultipleConcurrentBatches();
    await testErrorHandlingWithRealApi();
    
    console.log('='.repeat(60));
    console.log('✓ All integration tests passed!');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
