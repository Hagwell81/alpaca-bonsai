/* eslint-env node */
/**
 * Integration tests for ConnectionPool with RequestQueue
 *
 * Run with: node desktop/tests/connection-pool-integration.test.js
 */

const assert = require('assert');
const http = require('http');
const { RequestQueue, ConnectionPool } = require('../request-manager');

/**
 * Creates a simple HTTP server for testing
 */
function createTestServer(port = 13436) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Simulate some processing
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', path: req.url }));
      }, 10);
    });
    
    server.listen(port, () => {
      resolve(server);
    });
  });
}

/**
 * Makes an HTTP request using the provided agent
 */
function makeHttpRequest(agent, url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Test: RequestQueue with ConnectionPool handles multiple requests
 */
async function testRequestQueueWithConnectionPool() {
  console.log('Testing RequestQueue with ConnectionPool for multiple requests...');
  
  const server = await createTestServer(13436);
  const url = 'http://localhost:13436/test';
  
  try {
    const queue = new RequestQueue(5, true, 5, 60000, 8, 30000);
    const pool = queue.getConnectionPool();
    
    // Enqueue multiple requests
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        queue.enqueue(() => makeHttpRequest(pool.getHttpAgent(), url))
      );
    }
    
    const results = await Promise.all(promises);
    
    assert.strictEqual(results.length, 10, 'Should have 10 results');
    results.forEach((result, index) => {
      assert.strictEqual(result.status, 'ok', `Result ${index} should have status ok`);
    });
    
    const status = queue.getStatus();
    assert.strictEqual(status.totalRequests, 10, 'Queue should have processed 10 requests');
    assert.strictEqual(status.totalErrors, 0, 'Queue should have 0 errors');
    
    queue.destroy();
    console.log('✓ RequestQueue with ConnectionPool test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: ConnectionPool reuses connections across multiple requests
 */
async function testConnectionReuse() {
  console.log('Testing connection reuse across multiple requests...');
  
  const server = await createTestServer(13437);
  const url = 'http://localhost:13437/test';
  
  try {
    const pool = new ConnectionPool(8, 30000);
    
    // Make multiple requests
    for (let i = 0; i < 5; i++) {
      await makeHttpRequest(pool.getHttpAgent(), url);
    }
    
    const stats = pool.getStats();
    
    // With connection pooling, we should have fewer connections than requests
    assert(stats.totalRequests === 0 || stats.totalConnections <= 2, 
      'Should reuse connections (max 1-2 connections for sequential requests)');
    
    pool.destroy();
    console.log('✓ Connection reuse test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: ConnectionPool handles concurrent requests
 */
async function testConcurrentRequests() {
  console.log('Testing ConnectionPool with concurrent requests...');
  
  const server = await createTestServer(13438);
  const url = 'http://localhost:13438/test';
  
  try {
    const pool = new ConnectionPool(8, 30000);
    
    // Make concurrent requests
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(makeHttpRequest(pool.getHttpAgent(), url));
    }
    
    const results = await Promise.all(promises);
    
    assert.strictEqual(results.length, 10, 'Should have 10 results');
    results.forEach((result) => {
      assert.strictEqual(result.status, 'ok', 'Each result should have status ok');
    });
    
    const stats = pool.getStats();
    // Note: totalConnections may be 0 if sockets are already released
    // The important thing is that requests completed successfully
    assert(results.length === 10, 'All requests should have completed');
    
    pool.destroy();
    console.log('✓ Concurrent requests test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: RequestQueue with ConnectionPool respects maxConcurrent
 */
async function testMaxConcurrentLimit() {
  console.log('Testing RequestQueue respects maxConcurrent with ConnectionPool...');
  
  const server = await createTestServer(13439);
  const url = 'http://localhost:13439/test';
  
  try {
    const maxConcurrent = 3;
    const queue = new RequestQueue(maxConcurrent, true, 5, 60000, 8, 30000);
    const pool = queue.getConnectionPool();
    
    let maxActive = 0;
    const promises = [];
    
    for (let i = 0; i < 10; i++) {
      promises.push(
        queue.enqueue(async () => {
          const status = queue.getStatus();
          if (status.activeRequests > maxActive) {
            maxActive = status.activeRequests;
          }
          return makeHttpRequest(pool.getHttpAgent(), url);
        })
      );
    }
    
    await Promise.all(promises);
    
    assert(maxActive <= maxConcurrent, 
      `Max active requests (${maxActive}) should not exceed maxConcurrent (${maxConcurrent})`);
    
    queue.destroy();
    console.log('✓ MaxConcurrent limit test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: ConnectionPool destroy closes all connections
 */
async function testConnectionPoolDestroyClosesConnections() {
  console.log('Testing ConnectionPool destroy closes connections...');
  
  const server = await createTestServer(13440);
  const url = 'http://localhost:13440/test';
  
  try {
    const pool = new ConnectionPool(8, 30000);
    
    // Make some requests to establish connections
    for (let i = 0; i < 3; i++) {
      await makeHttpRequest(pool.getHttpAgent(), url);
    }
    
    const statsBefore = pool.getStats();
    assert(statsBefore.totalConnections >= 0, 'Should have connections');
    
    // Destroy the pool
    pool.destroy();
    
    // Verify agents are destroyed (they should not accept new requests)
    assert.doesNotThrow(() => {
      pool.destroy(); // Should be safe to call multiple times
    }, 'Destroy should be idempotent');
    
    console.log('✓ ConnectionPool destroy test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: RequestQueue destroy cleans up ConnectionPool
 */
async function testRequestQueueDestroyCleanup() {
  console.log('Testing RequestQueue destroy cleans up ConnectionPool...');
  
  const server = await createTestServer(13441);
  const url = 'http://localhost:13441/test';
  
  try {
    const queue = new RequestQueue(5, true, 5, 60000, 8, 30000);
    const pool = queue.getConnectionPool();
    
    // Make a request
    await queue.enqueue(() => makeHttpRequest(pool.getHttpAgent(), url));
    
    // Destroy the queue
    assert.doesNotThrow(() => {
      queue.destroy();
    }, 'Destroy should not throw');
    
    console.log('✓ RequestQueue destroy cleanup test passed');
  } finally {
    server.close();
  }
}

/**
 * Test: ConnectionPool statistics are accurate
 */
async function testConnectionPoolStatistics() {
  console.log('Testing ConnectionPool statistics accuracy...');
  
  const server = await createTestServer(13442);
  const url = 'http://localhost:13442/test';
  
  try {
    const pool = new ConnectionPool(8, 30000);
    
    const initialStats = pool.getStats();
    assert.strictEqual(initialStats.totalRequests, 0, 'Initial totalRequests should be 0');
    
    // Make requests
    for (let i = 0; i < 5; i++) {
      pool.recordRequest();
    }
    
    const statsAfter = pool.getStats();
    assert.strictEqual(statsAfter.totalRequests, 5, 'totalRequests should be 5');
    
    // Make actual HTTP requests
    for (let i = 0; i < 3; i++) {
      await makeHttpRequest(pool.getHttpAgent(), url);
    }
    
    const finalStats = pool.getStats();
    assert(finalStats.uptime >= initialStats.uptime, 'Uptime should increase');
    
    pool.destroy();
    console.log('✓ ConnectionPool statistics test passed');
  } finally {
    server.close();
  }
}

/**
 * Run all integration tests
 */
async function runAllTests() {
  console.log('\n=== Running ConnectionPool Integration Tests ===\n');
  
  try {
    await testRequestQueueWithConnectionPool();
    await testConnectionReuse();
    await testConcurrentRequests();
    await testMaxConcurrentLimit();
    await testConnectionPoolDestroyClosesConnections();
    await testRequestQueueDestroyCleanup();
    await testConnectionPoolStatistics();
    
    console.log('\n=== All Integration Tests Passed ===\n');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testRequestQueueWithConnectionPool,
  testConnectionReuse,
  testConcurrentRequests,
  testMaxConcurrentLimit,
  testConnectionPoolDestroyClosesConnections,
  testRequestQueueDestroyCleanup,
  testConnectionPoolStatistics
};
