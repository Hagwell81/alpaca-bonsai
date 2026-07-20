/* eslint-env node */
/**
 * Integration test: /v1/slots/status p95 latency requirement
 *
 * Verifies that the /v1/slots/status endpoint meets the p95 latency requirement
 * of < 50 ms under load (1000 requests at 10 rps).
 *
 * This test requires the API Gateway to be running. It makes no upstream calls
 * to slots (in-process only), so latency is purely gateway overhead.
 *
 * Run with:
 *   mocha desktop/tests/integration/slots-status-latency.test.js --timeout 180000
 *
 * Requirements: 8.5 (/v1/slots/status p95 latency < 50 ms)
 */

const assert = require('assert');
const http = require('http');
const { ApiGateway } = require('../../api-gateway');
const { SlotManager } = require('../../model-slot-manager');
const { VramBudgetManager } = require('../../vram-budget-manager');
const { ModelConfigStore } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

describe('Integration: /v1/slots/status p95 latency', function () {
  this.timeout(180000); // 3 minutes for 1000 requests

  let gateway;
  let slotManager;
  let vramBudgetManager;
  let modelConfigStore;
  let server;

  before(async function () {
    // Initialize managers
    vramBudgetManager = new VramBudgetManager();
    await vramBudgetManager.detect();

    // Create a mock model config store (in-memory)
    modelConfigStore = {
      get: () => null,
      getOrDefault: () => DEFAULT_ADVANCED_ARGS,
      set: () => {},
      delete: () => {},
      reconcile: () => {},
      listAll: () => ({}),
    };

    slotManager = new SlotManager({
      vramBudgetManager,
      modelConfigStore,
      logger: console,
    });

    await slotManager.init();

    // Create and start the gateway
    gateway = new ApiGateway({
      slotManager,
      vramBudgetManager,
      grammarLibrary: {
        get: () => '{}',
        has: () => true,
      },
      toolRewriter: {
        rewriteNonStreaming: (buf) => buf,
      },
      logger: console,
    });

    // Start the gateway on an ephemeral port
    await gateway.start();
  });

  after(async function () {
    if (gateway) {
      await gateway.drainAndClose();
    }
    if (slotManager) {
      await slotManager.stopAll();
    }
  });

  it('should respond to /v1/slots/status within p95 < 50 ms under 10 rps load', async function () {
    const TOTAL_REQUESTS = 1000;
    const RPS = 10; // requests per second
    const REQUEST_INTERVAL_MS = 1000 / RPS;
    const P95_THRESHOLD_MS = 50;

    // Extract the gateway's listening address and port
    const address = gateway.server.address();
    const gatewayUrl = `http://${address.address}:${address.port}`;

    const latencies = [];
    let successCount = 0;
    let errorCount = 0;

    /**
     * Make a single request to /v1/slots/status and measure latency
     */
    const makeRequest = () => {
      return new Promise((resolve) => {
        const startTime = process.hrtime.bigint();

        const req = http.get(`${gatewayUrl}/v1/slots/status`, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            const endTime = process.hrtime.bigint();
            const latencyMs = Number(endTime - startTime) / 1_000_000; // convert nanoseconds to ms

            if (res.statusCode === 200) {
              latencies.push(latencyMs);
              successCount++;
            } else {
              errorCount++;
            }

            resolve();
          });
        });

        req.on('error', (err) => {
          const endTime = process.hrtime.bigint();
          const latencyMs = Number(endTime - startTime) / 1_000_000;
          latencies.push(latencyMs);
          errorCount++;
          resolve();
        });
      });
    };

    /**
     * Send requests at a controlled rate (10 rps)
     */
    const startTime = Date.now();
    for (let i = 0; i < TOTAL_REQUESTS; i++) {
      // Schedule the request to maintain 10 rps
      const scheduledTime = startTime + i * REQUEST_INTERVAL_MS;
      const now = Date.now();
      const delayMs = Math.max(0, scheduledTime - now);

      await new Promise((resolve) => {
        setTimeout(async () => {
          await makeRequest();
          resolve();
        }, delayMs);
      });
    }

    // Calculate percentiles
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p50Index = Math.floor(sortedLatencies.length * 0.50);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    const p50 = sortedLatencies[p50Index];
    const p95 = sortedLatencies[p95Index];
    const p99 = sortedLatencies[p99Index];
    const minLatency = sortedLatencies[0];
    const maxLatency = sortedLatencies[sortedLatencies.length - 1];
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    // Log results
    console.log(`
    ========== /v1/slots/status Latency Report ==========
    Total Requests: ${TOTAL_REQUESTS}
    Successful: ${successCount}
    Errors: ${errorCount}
    
    Latency Statistics (ms):
      Min:  ${minLatency.toFixed(2)}
      P50:  ${p50.toFixed(2)}
      P95:  ${p95.toFixed(2)}
      P99:  ${p99.toFixed(2)}
      Max:  ${maxLatency.toFixed(2)}
      Avg:  ${avgLatency.toFixed(2)}
    
    Requirement: p95 < ${P95_THRESHOLD_MS} ms
    Status: ${p95 < P95_THRESHOLD_MS ? '✓ PASS' : '✗ FAIL'}
    =====================================================
    `);

    // Assertions
    assert.strictEqual(successCount, TOTAL_REQUESTS, `All ${TOTAL_REQUESTS} requests should succeed`);
    assert.strictEqual(errorCount, 0, 'No requests should error');
    assert(p95 < P95_THRESHOLD_MS, `p95 latency (${p95.toFixed(2)} ms) should be < ${P95_THRESHOLD_MS} ms`);
  });

  it('should return valid /v1/slots/status response structure', async function () {
    const address = gateway.server.address();
    const gatewayUrl = `http://${address.address}:${address.port}`;

    const response = await new Promise((resolve, reject) => {
      http.get(`${gatewayUrl}/v1/slots/status`, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    });

    assert.strictEqual(response.statusCode, 200, 'Should return 200 OK');
    assert(response.body.slots, 'Response should have slots array');
    assert.strictEqual(response.body.slots.length, 5, 'Should have exactly 5 slots');

    // Verify each slot has required fields
    for (const slot of response.body.slots) {
      assert.strictEqual(typeof slot.id, 'number', 'Slot should have id');
      assert.strictEqual(typeof slot.port, 'number', 'Slot should have port');
      assert.strictEqual(typeof slot.purpose, 'string', 'Slot should have purpose');
      assert.strictEqual(typeof slot.status, 'string', 'Slot should have status');
      assert(slot.metrics, 'Slot should have metrics');
      assert.strictEqual(typeof slot.metrics.tokensGenerated, 'number', 'Metrics should have tokensGenerated');
      assert.strictEqual(typeof slot.metrics.tokensPrompted, 'number', 'Metrics should have tokensPrompted');
      assert.strictEqual(typeof slot.metrics.requestsServed, 'number', 'Metrics should have requestsServed');
      assert.strictEqual(typeof slot.metrics.avgLatencyMs, 'number', 'Metrics should have avgLatencyMs');
    }
  });

  it('should maintain consistent response structure across multiple requests', async function () {
    const address = gateway.server.address();
    const gatewayUrl = `http://${address.address}:${address.port}`;

    const responses = [];

    for (let i = 0; i < 10; i++) {
      const response = await new Promise((resolve, reject) => {
        http.get(`${gatewayUrl}/v1/slots/status`, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (err) {
              reject(err);
            }
          });
        }).on('error', reject);
      });

      responses.push(response);
    }

    // Verify all responses have the same structure
    const firstResponse = responses[0];
    for (let i = 1; i < responses.length; i++) {
      const response = responses[i];
      assert.strictEqual(response.slots.length, firstResponse.slots.length, 'All responses should have same number of slots');

      for (let j = 0; j < response.slots.length; j++) {
        const slot = response.slots[j];
        const firstSlot = firstResponse.slots[j];
        assert.strictEqual(slot.id, firstSlot.id, `Slot ${j} id should be consistent`);
        assert.strictEqual(slot.port, firstSlot.port, `Slot ${j} port should be consistent`);
        assert.strictEqual(slot.purpose, firstSlot.purpose, `Slot ${j} purpose should be consistent`);
      }
    }
  });
});
