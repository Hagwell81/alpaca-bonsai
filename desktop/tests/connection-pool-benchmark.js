/* eslint-env node */
/**
 * Benchmark for ConnectionPool latency improvements
 *
 * Run with: node desktop/tests/connection-pool-benchmark.js
 */

const http = require('http');
const { ConnectionPool } = require('../request-manager');

/**
 * Creates a simple HTTP server for testing
 */
function createTestServer(port = 13434) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    });
    
    server.listen(port, () => {
      console.log(`Test server listening on port ${port}`);
      resolve(server);
    });
  });
}

/**
 * Makes an HTTP request and measures latency
 */
function makeRequest(agent, url) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const req = http.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const latency = Date.now() - startTime;
        resolve(latency);
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
 * Benchmark: Compare latency with and without connection pooling
 */
async function benchmarkConnectionPooling() {
  console.log('\n=== ConnectionPool Latency Benchmark ===\n');
  
  // Create test server
  const server = await createTestServer(13434);
  const url = 'http://localhost:13434/';
  
  try {
    // Warm up
    console.log('Warming up...');
    for (let i = 0; i < 5; i++) {
      await makeRequest(http.globalAgent, url);
    }
    
    // Benchmark without connection pooling (default agent)
    console.log('\nBenchmarking WITHOUT connection pooling (default agent)...');
    const defaultAgentLatencies = [];
    for (let i = 0; i < 20; i++) {
      const latency = await makeRequest(http.globalAgent, url);
      defaultAgentLatencies.push(latency);
    }
    
    // Benchmark with connection pooling
    console.log('Benchmarking WITH connection pooling...');
    const pool = new ConnectionPool(8, 30000);
    const pooledAgentLatencies = [];
    for (let i = 0; i < 20; i++) {
      const latency = await makeRequest(pool.getHttpAgent(), url);
      pooledAgentLatencies.push(latency);
    }
    pool.destroy();
    
    // Calculate statistics
    const calculateStats = (latencies) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)]
      };
    };
    
    const defaultStats = calculateStats(defaultAgentLatencies);
    const pooledStats = calculateStats(pooledAgentLatencies);
    
    // Print results
    console.log('\n--- Results ---\n');
    console.log('WITHOUT Connection Pooling (default agent):');
    console.log(`  Min:  ${defaultStats.min}ms`);
    console.log(`  Max:  ${defaultStats.max}ms`);
    console.log(`  Avg:  ${defaultStats.avg}ms`);
    console.log(`  P50:  ${defaultStats.p50}ms`);
    console.log(`  P95:  ${defaultStats.p95}ms`);
    console.log(`  P99:  ${defaultStats.p99}ms`);
    
    console.log('\nWITH Connection Pooling:');
    console.log(`  Min:  ${pooledStats.min}ms`);
    console.log(`  Max:  ${pooledStats.max}ms`);
    console.log(`  Avg:  ${pooledStats.avg}ms`);
    console.log(`  P50:  ${pooledStats.p50}ms`);
    console.log(`  P95:  ${pooledStats.p95}ms`);
    console.log(`  P99:  ${pooledStats.p99}ms`);
    
    // Calculate improvements
    const avgImprovement = defaultStats.avg - pooledStats.avg;
    const p95Improvement = defaultStats.p95 - pooledStats.p95;
    const p99Improvement = defaultStats.p99 - pooledStats.p99;
    
    console.log('\n--- Improvements ---\n');
    console.log(`Average latency reduction: ${avgImprovement}ms (${Math.round((avgImprovement / defaultStats.avg) * 100)}%)`);
    console.log(`P95 latency reduction:     ${p95Improvement}ms (${Math.round((p95Improvement / defaultStats.p95) * 100)}%)`);
    console.log(`P99 latency reduction:     ${p99Improvement}ms (${Math.round((p99Improvement / defaultStats.p99) * 100)}%)`);
    
    // Verify target improvement
    if (avgImprovement >= 30) {
      console.log('\n✓ Target latency improvement (~50ms) partially achieved');
    } else {
      console.log('\n⚠ Note: Latency improvement may vary based on system load and network conditions');
    }
    
  } finally {
    server.close();
    console.log('\nTest server closed');
  }
}

/**
 * Benchmark: Connection reuse verification
 */
async function benchmarkConnectionReuse() {
  console.log('\n=== Connection Reuse Benchmark ===\n');
  
  // Create test server
  const server = await createTestServer(13435);
  const url = 'http://localhost:13435/';
  
  try {
    const pool = new ConnectionPool(8, 30000);
    
    console.log('Making 10 sequential requests with connection pooling...');
    const startTime = Date.now();
    
    for (let i = 0; i < 10; i++) {
      await makeRequest(pool.getHttpAgent(), url);
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / 10;
    
    const stats = pool.getStats();
    
    console.log(`\nTotal time for 10 requests: ${totalTime}ms`);
    console.log(`Average time per request: ${avgTime}ms`);
    console.log(`\nConnection Pool Stats:`);
    console.log(`  Total Requests: ${stats.totalRequests}`);
    console.log(`  HTTP Sockets: ${stats.httpSockets}`);
    console.log(`  HTTPS Sockets: ${stats.httpsSockets}`);
    console.log(`  Total Connections: ${stats.totalConnections}`);
    
    if (stats.totalConnections <= 2) {
      console.log('\n✓ Connections are being reused (expected 1-2 connections for sequential requests)');
    }
    
    pool.destroy();
    
  } finally {
    server.close();
    console.log('\nTest server closed');
  }
}

/**
 * Run all benchmarks
 */
async function runAllBenchmarks() {
  try {
    await benchmarkConnectionPooling();
    await benchmarkConnectionReuse();
    
    console.log('\n=== Benchmarks Complete ===\n');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Benchmark failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run benchmarks if this file is executed directly
if (require.main === module) {
  runAllBenchmarks();
}

module.exports = {
  benchmarkConnectionPooling,
  benchmarkConnectionReuse
};
