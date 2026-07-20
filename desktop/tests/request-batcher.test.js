/* eslint-env node */
/**
 * Tests for RequestBatcher in request-batcher.js
 *
 * Run with: node desktop/tests/request-batcher.test.js
 */

const assert = require('assert');
const { RequestBatcher } = require('../request-batcher');

/**
 * Test: RequestBatcher initialization
 */
function testRequestBatcherInitialization() {
  console.log('Testing RequestBatcher initialization...');
  
  const batcher = new RequestBatcher(50, 100);
  
  assert.strictEqual(batcher.batchWindowMs, 50, 'batchWindowMs should be 50');
  assert.strictEqual(batcher.maxBatchSize, 100, 'maxBatchSize should be 100');
  assert.strictEqual(batcher.currentBatch.length, 0, 'currentBatch should be empty');
  assert.strictEqual(batcher.stats.totalBatches, 0, 'totalBatches should be 0');
  assert.strictEqual(batcher.stats.totalRequests, 0, 'totalRequests should be 0');
  
  batcher.destroy();
  console.log('✓ RequestBatcher initialization test passed');
}

/**
 * Test: RequestBatcher with custom parameters
 */
function testRequestBatcherCustomParameters() {
  console.log('Testing RequestBatcher with custom parameters...');
  
  const batcher = new RequestBatcher(100, 50);
  
  assert.strictEqual(batcher.batchWindowMs, 100, 'batchWindowMs should be 100');
  assert.strictEqual(batcher.maxBatchSize, 50, 'maxBatchSize should be 50');
  
  batcher.destroy();
  console.log('✓ RequestBatcher custom parameters test passed');
}

/**
 * Test: RequestBatcher parameter validation
 */
function testRequestBatcherParameterValidation() {
  console.log('Testing RequestBatcher parameter validation...');
  
  // Test invalid batchWindowMs (too low)
  try {
    new RequestBatcher(5, 100);
    assert.fail('Should throw error for batchWindowMs < 10');
  } catch (error) {
    assert(error.message.includes('batchWindowMs must be between 10 and 5000'));
  }
  
  // Test invalid batchWindowMs (too high)
  try {
    new RequestBatcher(6000, 100);
    assert.fail('Should throw error for batchWindowMs > 5000');
  } catch (error) {
    assert(error.message.includes('batchWindowMs must be between 10 and 5000'));
  }
  
  // Test invalid maxBatchSize (too low)
  try {
    new RequestBatcher(50, 0);
    assert.fail('Should throw error for maxBatchSize < 1');
  } catch (error) {
    assert(error.message.includes('maxBatchSize must be between 1 and 10000'));
  }
  
  // Test invalid maxBatchSize (too high)
  try {
    new RequestBatcher(50, 10001);
    assert.fail('Should throw error for maxBatchSize > 10000');
  } catch (error) {
    assert(error.message.includes('maxBatchSize must be between 1 and 10000'));
  }
  
  console.log('✓ RequestBatcher parameter validation test passed');
}

/**
 * Test: Single request batching
 */
async function testSingleRequestBatching() {
  console.log('Testing single request batching...');
  
  const mockApiCall = async (inputs) => {
    assert.strictEqual(inputs.length, 1, 'Should have 1 input');
    return [{ embedding: [0.1, 0.2, 0.3] }];
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  const result = await batcher.addRequest('test input');
  
  assert.deepStrictEqual(result, { embedding: [0.1, 0.2, 0.3] }, 'Should return embedding');
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch');
  assert.strictEqual(batcher.stats.totalRequests, 1, 'Should have 1 request');
  
  batcher.destroy();
  console.log('✓ Single request batching test passed');
}

/**
 * Test: Multiple requests batching within time window
 */
async function testMultipleRequestsBatching() {
  console.log('Testing multiple requests batching within time window...');
  
  const mockApiCall = async (inputs) => {
    assert.strictEqual(inputs.length, 3, 'Should have 3 inputs');
    return [
      { embedding: [0.1, 0.2] },
      { embedding: [0.3, 0.4] },
      { embedding: [0.5, 0.6] }
    ];
  };
  
  const batcher = new RequestBatcher(100, 100, mockApiCall);
  
  // Add multiple requests quickly
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  const promise3 = batcher.addRequest('input 3');
  
  const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
  
  assert.deepStrictEqual(result1, { embedding: [0.1, 0.2] }, 'Should return first embedding');
  assert.deepStrictEqual(result2, { embedding: [0.3, 0.4] }, 'Should return second embedding');
  assert.deepStrictEqual(result3, { embedding: [0.5, 0.6] }, 'Should return third embedding');
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch');
  assert.strictEqual(batcher.stats.totalRequests, 3, 'Should have 3 requests');
  
  batcher.destroy();
  console.log('✓ Multiple requests batching test passed');
}

/**
 * Test: Batch size limit triggers immediate flush
 */
async function testBatchSizeLimitFlush() {
  console.log('Testing batch size limit triggers immediate flush...');
  
  let callCount = 0;
  const mockApiCall = async (inputs) => {
    callCount++;
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(1000, 3, mockApiCall); // Large window, small batch size
  
  // Add 3 requests (should trigger flush immediately)
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  const promise3 = batcher.addRequest('input 3');
  
  const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
  
  assert.strictEqual(callCount, 1, 'Should have called API once');
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch');
  assert.strictEqual(batcher.stats.totalRequests, 3, 'Should have 3 requests');
  
  batcher.destroy();
  console.log('✓ Batch size limit flush test passed');
}

/**
 * Test: Multiple batches over time
 */
async function testMultipleBatchesOverTime() {
  console.log('Testing multiple batches over time...');
  
  let callCount = 0;
  const mockApiCall = async (inputs) => {
    callCount++;
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  // First batch
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  // Wait for first batch to flush
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Second batch
  const promise3 = batcher.addRequest('input 3');
  const promise4 = batcher.addRequest('input 4');
  
  const [result1, result2, result3, result4] = await Promise.all([promise1, promise2, promise3, promise4]);
  
  assert.strictEqual(callCount, 2, 'Should have called API twice');
  assert.strictEqual(batcher.stats.totalBatches, 2, 'Should have 2 batches');
  assert.strictEqual(batcher.stats.totalRequests, 4, 'Should have 4 requests');
  
  batcher.destroy();
  console.log('✓ Multiple batches over time test passed');
}

/**
 * Test: Error handling for batch failures
 */
async function testBatchErrorHandling() {
  console.log('Testing batch error handling...');
  
  const mockApiCall = async (inputs) => {
    throw new Error('API call failed');
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  try {
    await Promise.all([promise1, promise2]);
    assert.fail('Should have thrown error');
  } catch (error) {
    assert.strictEqual(error.message, 'API call failed', 'Should propagate API error');
  }
  
  assert.strictEqual(batcher.stats.totalErrors, 1, 'Should have 1 error');
  
  batcher.destroy();
  console.log('✓ Batch error handling test passed');
}

/**
 * Test: Response count mismatch detection
 */
async function testResponseCountMismatch() {
  console.log('Testing response count mismatch detection...');
  
  const mockApiCall = async (inputs) => {
    // Return wrong number of embeddings
    return [{ embedding: [0.1] }];
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  try {
    await Promise.all([promise1, promise2]);
    assert.fail('Should have thrown error');
  } catch (error) {
    assert(error.message.includes('Response count'), 'Should detect response count mismatch');
  }
  
  batcher.destroy();
  console.log('✓ Response count mismatch test passed');
}

/**
 * Test: Statistics tracking
 */
async function testStatisticsTracking() {
  console.log('Testing statistics tracking...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  // Add requests
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(batcher.addRequest(`input ${i}`));
  }
  
  await Promise.all(promises);
  
  const stats = batcher.getStats();
  
  assert.strictEqual(stats.totalBatches, 1, 'Should have 1 batch');
  assert.strictEqual(stats.totalRequests, 5, 'Should have 5 requests');
  assert.strictEqual(stats.avgBatchSize, 5, 'Average batch size should be 5');
  assert.strictEqual(stats.minBatchSize, 5, 'Min batch size should be 5');
  assert.strictEqual(stats.maxBatchSize, 5, 'Max batch size in stats should be 5');
  assert(stats.avgBatchTime >= 0, 'Average batch time should be >= 0');
  assert(stats.apiCallReduction.includes('%'), 'Should include API call reduction percentage');
  
  batcher.destroy();
  console.log('✓ Statistics tracking test passed');
}

/**
 * Test: Manual flush
 */
async function testManualFlush() {
  console.log('Testing manual flush...');
  
  let callCount = 0;
  const mockApiCall = async (inputs) => {
    callCount++;
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(5000, 100, mockApiCall); // Large window
  
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  // Manually flush before window expires
  await batcher.flush();
  
  const [result1, result2] = await Promise.all([promise1, promise2]);
  
  assert.strictEqual(callCount, 1, 'Should have called API once');
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch');
  
  batcher.destroy();
  console.log('✓ Manual flush test passed');
}

/**
 * Test: Clear pending requests
 */
async function testClearPending() {
  console.log('Testing clear pending requests...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(5000, 100, mockApiCall); // Large window
  
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  // Clear pending requests
  batcher.clearPending(new Error('Cleared'));
  
  try {
    await Promise.all([promise1, promise2]);
    assert.fail('Should have thrown error');
  } catch (error) {
    assert.strictEqual(error.message, 'Cleared', 'Should reject with clear error');
  }
  
  batcher.destroy();
  console.log('✓ Clear pending requests test passed');
}

/**
 * Test: Reset statistics
 */
async function testResetStatistics() {
  console.log('Testing reset statistics...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  // Add requests
  const promises = [];
  for (let i = 0; i < 3; i++) {
    promises.push(batcher.addRequest(`input ${i}`));
  }
  
  await Promise.all(promises);
  
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch before reset');
  
  // Reset statistics
  batcher.resetStats();
  
  assert.strictEqual(batcher.stats.totalBatches, 0, 'Should have 0 batches after reset');
  assert.strictEqual(batcher.stats.totalRequests, 0, 'Should have 0 requests after reset');
  assert.strictEqual(batcher.stats.totalErrors, 0, 'Should have 0 errors after reset');
  
  batcher.destroy();
  console.log('✓ Reset statistics test passed');
}

/**
 * Test: Event emission on batch complete
 */
async function testBatchCompleteEvent() {
  console.log('Testing batch complete event emission...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  let eventEmitted = false;
  let eventData = null;
  
  batcher.on('batch-complete', (data) => {
    eventEmitted = true;
    eventData = data;
  });
  
  const promises = [];
  for (let i = 0; i < 2; i++) {
    promises.push(batcher.addRequest(`input ${i}`));
  }
  
  await Promise.all(promises);
  
  assert(eventEmitted, 'Should emit batch-complete event');
  assert.strictEqual(eventData.batchSize, 2, 'Event should contain batch size');
  assert(eventData.duration >= 0, 'Event should contain duration');
  assert(eventData.timestamp, 'Event should contain timestamp');
  
  batcher.destroy();
  console.log('✓ Batch complete event test passed');
}

/**
 * Test: Event emission on batch error
 */
async function testBatchErrorEvent() {
  console.log('Testing batch error event emission...');
  
  const mockApiCall = async (inputs) => {
    throw new Error('Test error');
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  let eventEmitted = false;
  let eventData = null;
  
  batcher.on('batch-error', (data) => {
    eventEmitted = true;
    eventData = data;
  });
  
  const promise1 = batcher.addRequest('input 1');
  const promise2 = batcher.addRequest('input 2');
  
  try {
    await Promise.all([promise1, promise2]);
  } catch (error) {
    // Expected
  }
  
  assert(eventEmitted, 'Should emit batch-error event');
  assert.strictEqual(eventData.batchSize, 2, 'Event should contain batch size');
  assert.strictEqual(eventData.error, 'Test error', 'Event should contain error message');
  assert(eventData.timestamp, 'Event should contain timestamp');
  
  batcher.destroy();
  console.log('✓ Batch error event test passed');
}

/**
 * Test: Array input handling
 */
async function testArrayInputHandling() {
  console.log('Testing array input handling...');
  
  const mockApiCall = async (inputs) => {
    assert.strictEqual(inputs.length, 2, 'Should have 2 inputs');
    return [
      { embedding: [0.1, 0.2] },
      { embedding: [0.3, 0.4] }
    ];
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  const promise1 = batcher.addRequest(['text1', 'text2']);
  const promise2 = batcher.addRequest(['text3', 'text4']);
  
  const [result1, result2] = await Promise.all([promise1, promise2]);
  
  assert.deepStrictEqual(result1, { embedding: [0.1, 0.2] }, 'Should return first embedding');
  assert.deepStrictEqual(result2, { embedding: [0.3, 0.4] }, 'Should return second embedding');
  
  batcher.destroy();
  console.log('✓ Array input handling test passed');
}

/**
 * Test: Large batch processing
 */
async function testLargeBatchProcessing() {
  console.log('Testing large batch processing...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(50, 100, mockApiCall);
  
  // Add 100 requests (should trigger batch size limit)
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(batcher.addRequest(`input ${i}`));
  }
  
  const results = await Promise.all(promises);
  
  assert.strictEqual(results.length, 100, 'Should have 100 results');
  assert.strictEqual(batcher.stats.totalBatches, 1, 'Should have 1 batch');
  assert.strictEqual(batcher.stats.totalRequests, 100, 'Should have 100 requests');
  
  batcher.destroy();
  console.log('✓ Large batch processing test passed');
}

/**
 * Test: Concurrent batch operations
 */
async function testConcurrentBatchOperations() {
  console.log('Testing concurrent batch operations...');
  
  const mockApiCall = async (inputs) => {
    return inputs.map((_, i) => ({ embedding: [i] }));
  };
  
  const batcher = new RequestBatcher(100, 100, mockApiCall);
  
  // Create multiple concurrent batches
  const batch1Promises = [];
  for (let i = 0; i < 5; i++) {
    batch1Promises.push(batcher.addRequest(`batch1-input${i}`));
  }
  
  // Wait a bit then add second batch
  await new Promise(resolve => setTimeout(resolve, 150));
  
  const batch2Promises = [];
  for (let i = 0; i < 3; i++) {
    batch2Promises.push(batcher.addRequest(`batch2-input${i}`));
  }
  
  const allResults = await Promise.all([...batch1Promises, ...batch2Promises]);
  
  assert.strictEqual(allResults.length, 8, 'Should have 8 results');
  assert.strictEqual(batcher.stats.totalBatches, 2, 'Should have 2 batches');
  assert.strictEqual(batcher.stats.totalRequests, 8, 'Should have 8 requests');
  
  batcher.destroy();
  console.log('✓ Concurrent batch operations test passed');
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('Running RequestBatcher Tests');
  console.log('='.repeat(60));
  
  try {
    testRequestBatcherInitialization();
    testRequestBatcherCustomParameters();
    testRequestBatcherParameterValidation();
    await testSingleRequestBatching();
    await testMultipleRequestsBatching();
    await testBatchSizeLimitFlush();
    await testMultipleBatchesOverTime();
    await testBatchErrorHandling();
    await testResponseCountMismatch();
    await testStatisticsTracking();
    await testManualFlush();
    await testClearPending();
    await testResetStatistics();
    await testBatchCompleteEvent();
    await testBatchErrorEvent();
    await testArrayInputHandling();
    await testLargeBatchProcessing();
    await testConcurrentBatchOperations();
    
    console.log('='.repeat(60));
    console.log('✓ All tests passed!');
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
