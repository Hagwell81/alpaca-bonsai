/* eslint-env node */
/**
 * Load Testing Script for Alpaca API
 * 
 * Tests API endpoints under various load conditions to verify
 * performance, concurrency handling, and error recovery.
 * 
 * Usage:
 *   node test-load.js [url] [numRequests] [concurrency]
 * 
 * Examples:
 *   node test-load.js                    # Test with defaults (100 req, 10 concurrent)
 *   node test-load.js http://localhost:13434 50 5
 *   node test-load.js http://localhost:13434 1000 50
 */

const http = require('http');

/**
 * Runs a load test against the specified API URL.
 * 
 * @param {string} url - Base URL of the API server
 * @param {number} numRequests - Total number of requests to send
 * @param {number} concurrency - Number of concurrent requests
 * @param {number} timeoutMs - Request timeout in milliseconds
 * @returns {Promise<Object>} Test results with statistics
 */
async function runLoadTest(url, numRequests = 100, concurrency = 10, timeoutMs = 10000) {
  console.log(`\n=== Load Test Started ===`);
  console.log(`URL: ${url}`);
  console.log(`Requests: ${numRequests}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Timeout: ${timeoutMs}ms\n`);

  const results = {
    successful: 0,
    failed: 0,
    timeout: 0,
    totalTime: 0,
    latencies: [],
    errors: [],
    statusCodes: {},
    startTime: Date.now(),
    endTime: null,
  };

  let completed = 0;
  let active = 0;
  const queue = [];

  /**
   * Makes a single HTTP request and records results.
   * 
   * @param {string} endpoint - API endpoint path
   * @returns {Promise<void>}
   */
  const makeRequest = (endpoint = '/v1/models') => {
    return new Promise((resolve) => {
      const reqStart = Date.now();
      const fullUrl = `${url}${endpoint}`;

      const req = http.get(fullUrl, { timeout: timeoutMs }, (res) => {
        const latency = Date.now() - reqStart;
        results.latencies.push(latency);

        // Record status code
        const statusCode = res.statusCode;
        results.statusCodes[statusCode] = (results.statusCodes[statusCode] || 0) + 1;

        if (statusCode === 200) {
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(`HTTP ${statusCode}`);
        }

        // Consume response data to avoid memory leaks
        res.on('data', () => {});
        res.on('end', () => {
          completed++;
          active--;
          printProgress();
          resolve();
        });
      });

      req.on('error', (err) => {
        results.failed++;
        results.errors.push(`Error: ${err.message}`);
        completed++;
        active--;
        printProgress();
        resolve();
      });

      req.on('timeout', () => {
        results.timeout++;
        results.failed++;
        results.errors.push('Timeout');
        req.destroy();
        completed++;
        active--;
        printProgress();
        resolve();
      });

      active++;
    });
  };

  /**
   * Prints progress to console.
   */
  const printProgress = () => {
    if (completed % 10 === 0 || completed === numRequests) {
      const pct = ((completed / numRequests) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${completed}/${numRequests} (${pct}%) - Active: ${active}  `);
    }
  };

  // Run requests with concurrency limit
  for (let i = 0; i < numRequests; i++) {
    const promise = makeRequest();
    queue.push(promise);

    // If we've reached concurrency limit, wait for one to complete
    if (active >= concurrency) {
      await Promise.race(queue);
      // Remove completed promises from queue
      for (let j = queue.length - 1; j >= 0; j--) {
        const p = queue[j];
        // Check if promise is settled
        if (p._isSettled) continue;
      }
    }

    // Clean up completed promises from queue
    const settledPromises = await Promise.allSettled(queue.slice(0, Math.max(0, queue.length - concurrency)));
    queue.splice(0, settledPromises.length);
  }

  // Wait for all remaining requests to complete
  await Promise.all(queue);

  results.endTime = Date.now();
  results.totalTime = results.endTime - results.startTime;

  printResults();
  return results;
}

/**
 * Prints formatted test results to console.
 */
function printResults() {
  console.log('\n\n=== Load Test Results ===\n');

  console.log(`Total Time: ${results.totalTime}ms (${(results.totalTime / 1000).toFixed(2)}s)`);
  console.log(`Successful: ${results.successful}/${numRequests} (${((results.successful / numRequests) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${results.failed}/${numRequests} (${((results.failed / numRequests) * 100).toFixed(1)}%)`);
  console.log(`Timeouts: ${results.timeout}`);
  console.log(`Throughput: ${(numRequests / (results.totalTime / 1000)).toFixed(2)} req/s`);

  console.log('\nStatus Codes:');
  for (const [code, count] of Object.entries(results.statusCodes)) {
    console.log(`  ${code}: ${count}`);
  }

  if (results.latencies.length > 0) {
    const sorted = results.latencies.sort((a, b) => a - b);
    console.log('\nLatency (ms):');
    console.log(`  Min: ${sorted[0]}`);
    console.log(`  P50: ${sorted[Math.floor(sorted.length * 0.5)] || 0}`);
    console.log(`  P95: ${sorted[Math.floor(sorted.length * 0.95)] || 0}`);
    console.log(`  P99: ${sorted[Math.floor(sorted.length * 0.99)] || 0}`);
    console.log(`  Max: ${sorted[sorted.length - 1]}`);
    console.log(`  Avg: ${Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)}`);
  }

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    const errorCounts = {};
    for (const err of results.errors) {
      errorCounts[err] = (errorCounts[err] || 0) + 1;
    }
    for (const [err, count] of Object.entries(errorCounts)) {
      console.log(`  ${err}: ${count}`);
    }
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Runs a health check against the API server.
 * 
 * @param {string} url - Base URL of the API server
 * @returns {Promise<Object>} Health check result
 */
async function healthCheck(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/`, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          healthy: res.statusCode === 200,
          data: data.substring(0, 200),
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 0,
        healthy: false,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        healthy: false,
        error: 'Timeout',
      });
    });
  });
}

/**
 * Main execution function.
 */
async function main() {
  const url = process.argv[2] || 'http://localhost:13434';
  const numRequests = parseInt(process.argv[3]) || 100;
  const concurrency = parseInt(process.argv[4]) || 10;
  const timeoutMs = parseInt(process.argv[5]) || 10000;

  console.log('Alpaca Load Testing Tool');
  console.log('=================================\n');

  // First, run a health check
  console.log('Running health check...');
  const health = await healthCheck(url);

  if (!health.healthy) {
    console.error(`\nHealth check failed: ${health.error || `HTTP ${health.status}`}`);
    console.error(`\nIs the server running at ${url}?`);
    console.error(`Start the server with: npm start`);
    process.exit(1);
  }

  console.log(`Health check passed (HTTP ${health.status})\n`);

  // Run the load test
  const results = await runLoadTest(url, numRequests, concurrency, timeoutMs);

  // Determine if test passed
  const successRate = results.successful / numRequests;
  const avgLatency = results.latencies.length > 0
    ? results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length
    : 0;

  console.log('\n=== Summary ===');
  if (successRate >= 0.95 && avgLatency < 1000) {
    console.log('Result: PASS - Server handles load well');
  } else if (successRate >= 0.80) {
    console.log('Result: WARNING - Server shows some strain under load');
  } else {
    console.log('Result: FAIL - Server struggles under load');
  }

  console.log(`\nRecommendations:`);
  if (successRate < 0.95) {
    console.log(`  - Increase maxConcurrentRequests in API config`);
    console.log(`  - Check for resource limits (CPU, memory)`);
    console.log(`  - Enable circuit breaker for automatic recovery`);
  }
  if (avgLatency > 500) {
    console.log(`  - Consider reducing model context size`);
    console.log(`  - Enable request queuing to prevent overload`);
    console.log(`  - Check network latency`);
  }
  if (results.timeout > 0) {
    console.log(`  - Increase request timeout`);
    console.log(`  - Check if model is properly loaded`);
    console.log(`  - Verify server has sufficient resources`);
  }

  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

// Run main
if (require.main === module) {
  main().catch((err) => {
    console.error('Load test failed:', err);
    process.exit(1);
  });
}

module.exports = { runLoadTest, healthCheck };
