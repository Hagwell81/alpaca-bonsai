/* eslint-env node */
/**
 * Tests for ConnectionPool in request-manager.js
 *
 * Run with: node desktop/tests/connection-pool.test.js
 */

const assert = require('assert');
const http = require('http');
const https = require('https');
const { ConnectionPool, RequestQueue } = require('../request-manager');

/**
 * Test: ConnectionPool initialization
 */
function testConnectionPoolInitialization() {
  console.log('Testing ConnectionPool initialization...');
  
  const pool = new ConnectionPool(8, 30000);
  
  assert.strictEqual(pool.maxSockets, 8, 'maxSockets should be 8');
  assert.strictEqual(pool.keepAliveMs, 30000, 'keepAliveMs should be 30000');
  assert(pool.httpAgent instanceof http.Agent, 'httpAgent should be http.Agent');
  assert(pool.httpsAgent instanceof https.Agent, 'httpsAgent should be https.Agent');
  assert.strictEqual(pool.stats.totalRequests, 0, 'totalRequests should start at 0');
  
  pool.destroy();
  console.log('✓ ConnectionPool initialization test passed');
}

/**
 * Test: ConnectionPool with custom parameters
 */
function testConnectionPoolCustomParameters() {
  console.log('Testing ConnectionPool with custom parameters...');
  
  const pool = new ConnectionPool(16, 60000);
  
  assert.strictEqual(pool.maxSockets, 16, 'maxSockets should be 16');
  assert.strictEqual(pool.keepAliveMs, 60000, 'keepAliveMs should be 60000');
  
  pool.destroy();
  console.log('✓ ConnectionPool custom parameters test passed');
}

/**
 * Test: getAgent returns correct agent for URL
 */
function testGetAgentForUrl() {
  console.log('Testing getAgent for different URLs...');
  
  const pool = new ConnectionPool();
  
  const httpAgent = pool.getAgent('http://localhost:3000');
  assert.strictEqual(httpAgent, pool.httpAgent, 'Should return httpAgent for http URL');
  
  const httpsAgent = pool.getAgent('https://api.example.com');
  assert.strictEqual(httpsAgent, pool.httpsAgent, 'Should return httpsAgent for https URL');
  
  const defaultAgent = pool.getAgent('localhost:3000');
  assert.strictEqual(defaultAgent, pool.httpAgent, 'Should return httpAgent for non-https URL');
  
  pool.destroy();
  console.log('✓ getAgent test passed');
}

/**
 * Test: getHttpAgent and getHttpsAgent methods
 */
function testGetAgentMethods() {
  console.log('Testing getHttpAgent and getHttpsAgent methods...');
  
  const pool = new ConnectionPool();
  
  const httpAgent = pool.getHttpAgent();
  assert.strictEqual(httpAgent, pool.httpAgent, 'getHttpAgent should return httpAgent');
  
  const httpsAgent = pool.getHttpsAgent();
  assert.strictEqual(httpsAgent, pool.httpsAgent, 'getHttpsAgent should return httpsAgent');
  
  pool.destroy();
  console.log('✓ getHttpAgent and getHttpsAgent test passed');
}

/**
 * Test: recordRequest increments counter
 */
function testRecordRequest() {
  console.log('Testing recordRequest...');
  
  const pool = new ConnectionPool();
  
  assert.strictEqual(pool.stats.totalRequests, 0, 'totalRequests should start at 0');
  
  pool.recordRequest();
  assert.strictEqual(pool.stats.totalRequests, 1, 'totalRequests should be 1 after recordRequest');
  
  pool.recordRequest();
  pool.recordRequest();
  assert.strictEqual(pool.stats.totalRequests, 3, 'totalRequests should be 3 after 3 recordRequest calls');
  
  pool.destroy();
  console.log('✓ recordRequest test passed');
}

/**
 * Test: getStats returns pool statistics
 */
function testGetStats() {
  console.log('Testing getStats...');
  
  const pool = new ConnectionPool(8, 30000);
  pool.recordRequest();
  pool.recordRequest();
  
  const stats = pool.getStats();
  
  assert.strictEqual(stats.maxSockets, 8, 'stats.maxSockets should be 8');
  assert.strictEqual(stats.keepAliveMs, 30000, 'stats.keepAliveMs should be 30000');
  assert.strictEqual(stats.totalRequests, 2, 'stats.totalRequests should be 2');
  assert(typeof stats.httpSockets === 'number', 'stats.httpSockets should be a number');
  assert(typeof stats.httpsSockets === 'number', 'stats.httpsSockets should be a number');
  assert(typeof stats.totalConnections === 'number', 'stats.totalConnections should be a number');
  assert(typeof stats.uptime === 'number', 'stats.uptime should be a number');
  assert(stats.uptime >= 0, 'stats.uptime should be non-negative');
  
  pool.destroy();
  console.log('✓ getStats test passed');
}

/**
 * Test: ConnectionPool destroy method
 */
function testConnectionPoolDestroy() {
  console.log('Testing ConnectionPool destroy...');
  
  const pool = new ConnectionPool();
  
  // Verify agents exist before destroy
  assert(pool.httpAgent, 'httpAgent should exist before destroy');
  assert(pool.httpsAgent, 'httpsAgent should exist before destroy');
  
  // Destroy should not throw
  assert.doesNotThrow(() => {
    pool.destroy();
  }, 'destroy should not throw');
  
  console.log('✓ ConnectionPool destroy test passed');
}

/**
 * Test: RequestQueue integration with ConnectionPool
 */
function testRequestQueueConnectionPoolIntegration() {
  console.log('Testing RequestQueue integration with ConnectionPool...');
  
  const queue = new RequestQueue(10, true, 5, 60000, 8, 30000);
  
  assert(queue.connectionPool instanceof ConnectionPool, 'RequestQueue should have ConnectionPool');
  assert.strictEqual(queue.connectionPool.maxSockets, 8, 'ConnectionPool maxSockets should be 8');
  assert.strictEqual(queue.connectionPool.keepAliveMs, 30000, 'ConnectionPool keepAliveMs should be 30000');
  
  queue.destroy();
  console.log('✓ RequestQueue ConnectionPool integration test passed');
}

/**
 * Test: RequestQueue getConnectionPool method
 */
function testRequestQueueGetConnectionPool() {
  console.log('Testing RequestQueue getConnectionPool method...');
  
  const queue = new RequestQueue();
  const pool = queue.getConnectionPool();
  
  assert(pool instanceof ConnectionPool, 'getConnectionPool should return ConnectionPool instance');
  assert.strictEqual(pool, queue.connectionPool, 'getConnectionPool should return the same instance');
  
  queue.destroy();
  console.log('✓ RequestQueue getConnectionPool test passed');
}

/**
 * Test: RequestQueue getStatus includes connection pool stats
 */
function testRequestQueueStatusIncludesPoolStats() {
  console.log('Testing RequestQueue getStatus includes connection pool stats...');
  
  const queue = new RequestQueue();
  const status = queue.getStatus();
  
  assert(status.connectionPool, 'status should include connectionPool');
  assert.strictEqual(status.connectionPool.maxSockets, 8, 'connectionPool.maxSockets should be 8');
  assert(typeof status.connectionPool.totalRequests === 'number', 'connectionPool.totalRequests should be a number');
  assert(typeof status.connectionPool.totalConnections === 'number', 'connectionPool.totalConnections should be a number');
  
  queue.destroy();
  console.log('✓ RequestQueue getStatus includes pool stats test passed');
}

/**
 * Test: RequestQueue destroy cleans up connection pool
 */
function testRequestQueueDestroyCleanup() {
  console.log('Testing RequestQueue destroy cleanup...');
  
  const queue = new RequestQueue();
  const pool = queue.connectionPool;
  
  // Verify pool exists
  assert(pool, 'connectionPool should exist');
  
  // Destroy should not throw
  assert.doesNotThrow(() => {
    queue.destroy();
  }, 'destroy should not throw');
  
  console.log('✓ RequestQueue destroy cleanup test passed');
}

/**
 * Test: ConnectionPool keep-alive configuration
 */
function testConnectionPoolKeepAliveConfig() {
  console.log('Testing ConnectionPool keep-alive configuration...');
  
  const pool = new ConnectionPool(8, 30000);
  
  // Check HTTP agent configuration
  assert.strictEqual(pool.httpAgent.keepAlive, true, 'httpAgent.keepAlive should be true');
  assert.strictEqual(pool.httpAgent.maxSockets, 8, 'httpAgent.maxSockets should be 8');
  assert.strictEqual(pool.httpAgent.keepAliveMsecs, 30000, 'httpAgent.keepAliveMsecs should be 30000');
  
  // Check HTTPS agent configuration
  assert.strictEqual(pool.httpsAgent.keepAlive, true, 'httpsAgent.keepAlive should be true');
  assert.strictEqual(pool.httpsAgent.maxSockets, 8, 'httpsAgent.maxSockets should be 8');
  assert.strictEqual(pool.httpsAgent.keepAliveMsecs, 30000, 'httpsAgent.keepAliveMsecs should be 30000');
  
  pool.destroy();
  console.log('✓ ConnectionPool keep-alive configuration test passed');
}

/**
 * Test: Multiple ConnectionPool instances are independent
 */
function testMultipleConnectionPoolInstances() {
  console.log('Testing multiple ConnectionPool instances...');
  
  const pool1 = new ConnectionPool(8, 30000);
  const pool2 = new ConnectionPool(16, 60000);
  
  assert.notStrictEqual(pool1.httpAgent, pool2.httpAgent, 'Different pools should have different httpAgents');
  assert.notStrictEqual(pool1.httpsAgent, pool2.httpsAgent, 'Different pools should have different httpsAgents');
  
  pool1.recordRequest();
  pool2.recordRequest();
  pool2.recordRequest();
  
  assert.strictEqual(pool1.stats.totalRequests, 1, 'pool1 should have 1 request');
  assert.strictEqual(pool2.stats.totalRequests, 2, 'pool2 should have 2 requests');
  
  pool1.destroy();
  pool2.destroy();
  console.log('✓ Multiple ConnectionPool instances test passed');
}

/**
 * Test: ConnectionPool stats uptime increases
 */
function testConnectionPoolStatsUptime() {
  console.log('Testing ConnectionPool stats uptime...');
  
  const pool = new ConnectionPool();
  const stats1 = pool.getStats();
  
  // Wait a bit
  const startTime = Date.now();
  while (Date.now() - startTime < 10) {
    // Busy wait for ~10ms
  }
  
  const stats2 = pool.getStats();
  
  assert(stats2.uptime >= stats1.uptime, 'uptime should increase or stay the same');
  
  pool.destroy();
  console.log('✓ ConnectionPool stats uptime test passed');
}

/**
 * Run all tests
 */
function runAllTests() {
  console.log('\n=== Running ConnectionPool Tests ===\n');
  
  try {
    testConnectionPoolInitialization();
    testConnectionPoolCustomParameters();
    testGetAgentForUrl();
    testGetAgentMethods();
    testRecordRequest();
    testGetStats();
    testConnectionPoolDestroy();
    testRequestQueueConnectionPoolIntegration();
    testRequestQueueGetConnectionPool();
    testRequestQueueStatusIncludesPoolStats();
    testRequestQueueDestroyCleanup();
    testConnectionPoolKeepAliveConfig();
    testMultipleConnectionPoolInstances();
    testConnectionPoolStatsUptime();
    
    console.log('\n=== All ConnectionPool Tests Passed ===\n');
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
  testConnectionPoolInitialization,
  testConnectionPoolCustomParameters,
  testGetAgentForUrl,
  testGetAgentMethods,
  testRecordRequest,
  testGetStats,
  testConnectionPoolDestroy,
  testRequestQueueConnectionPoolIntegration,
  testRequestQueueGetConnectionPool,
  testRequestQueueStatusIncludesPoolStats,
  testRequestQueueDestroyCleanup,
  testConnectionPoolKeepAliveConfig,
  testMultipleConnectionPoolInstances,
  testConnectionPoolStatsUptime
};
