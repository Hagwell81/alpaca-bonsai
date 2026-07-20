/* eslint-env node */
/**
 * Tests for StartupTelemetry in startup-telemetry.js
 *
 * Run with: node desktop/tests/startup-telemetry.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { StartupTelemetry } = require('../startup-telemetry');

// Use temporary directory for test databases
const tempDir = path.join(os.tmpdir(), 'startup-telemetry-tests');

/**
 * Ensure temp directory exists
 */
function ensureTempDir() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
}

/**
 * Clean up test database
 */
function cleanupTestDb(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

/**
 * Test: StartupTelemetry initialization
 */
async function testStartupTelemetryInitialization() {
  console.log('Testing StartupTelemetry initialization...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-init.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  
  assert.strictEqual(telemetry.initialized, false, 'Should not be initialized before init()');
  assert.strictEqual(telemetry.slowStartupThresholdMs, 120000, 'Default threshold should be 120s');
  assert.strictEqual(telemetry.retentionDays, 90, 'Default retention should be 90 days');
  
  await telemetry.initialize();
  
  assert.strictEqual(telemetry.initialized, true, 'Should be initialized after init()');
  assert.ok(fs.existsSync(dbPath), 'Database file should exist');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ StartupTelemetry initialization test passed');
}

/**
 * Test: Record startup stage
 */
async function testRecordStage() {
  console.log('Testing record startup stage...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-record.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record stages
  await telemetry.recordStage('binary-check', 100);
  await telemetry.recordStage('model-load', 5000);
  await telemetry.recordStage('http-bind', 500);
  await telemetry.recordStage('webui-load', 2000);
  await telemetry.recordStage('total', 7600);
  
  // Verify stages are recorded in current session
  assert.strictEqual(telemetry.currentSession.stages['binary-check'], 100);
  assert.strictEqual(telemetry.currentSession.stages['model-load'], 5000);
  assert.strictEqual(telemetry.currentSession.stages['total'], 7600);
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Record startup stage test passed');
}

/**
 * Test: Record stage with metadata
 */
async function testRecordStageWithMetadata() {
  console.log('Testing record stage with metadata...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-metadata.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record with metadata
  await telemetry.recordStage('model-load', 5000, {
    model: 'Qwen3.5-9B-Q4_K_M.gguf',
    backend: 'cuda'
  });
  
  assert.strictEqual(telemetry.currentSession.model, 'Qwen3.5-9B-Q4_K_M.gguf');
  assert.strictEqual(telemetry.currentSession.backend, 'cuda');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Record stage with metadata test passed');
}

/**
 * Test: Invalid stage parameters
 */
async function testInvalidStageParameters() {
  console.log('Testing invalid stage parameters...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-invalid.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Test invalid stage name
  try {
    await telemetry.recordStage('', 100);
    assert.fail('Should throw error for empty stage name');
  } catch (err) {
    assert.ok(err.message.includes('non-empty string'));
  }
  
  // Test invalid duration
  try {
    await telemetry.recordStage('test', -100);
    assert.fail('Should throw error for negative duration');
  } catch (err) {
    assert.ok(err.message.includes('non-negative'));
  }
  
  // Test non-numeric duration
  try {
    await telemetry.recordStage('test', 'not-a-number');
    assert.fail('Should throw error for non-numeric duration');
  } catch (err) {
    assert.ok(err.message.includes('non-negative'));
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Invalid stage parameters test passed');
}

/**
 * Test: Compute stage statistics
 */
async function testComputeStageStats() {
  console.log('Testing compute stage statistics...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-stats.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record multiple stages
  const durations = [100, 200, 150, 300, 250, 180, 220, 190, 210, 240];
  for (const duration of durations) {
    await telemetry.recordStage('test-stage', duration);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  assert.ok(metrics.stageMetrics['test-stage'], 'Should have test-stage metrics');
  const stats = metrics.stageMetrics['test-stage'];
  
  assert.strictEqual(stats.count, 10, 'Should have 10 records');
  assert.strictEqual(stats.min, 100, 'Min should be 100');
  assert.strictEqual(stats.max, 300, 'Max should be 300');
  assert.ok(stats.average > 0, 'Average should be positive');
  assert.ok(stats.p95 > 0, 'P95 should be positive');
  assert.ok(stats.median > 0, 'Median should be positive');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Compute stage statistics test passed');
}

/**
 * Test: Get metrics
 */
async function testGetMetrics() {
  console.log('Testing get metrics...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-metrics.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record a complete startup
  await telemetry.recordStage('binary-check', 100);
  await telemetry.recordStage('model-load', 5000);
  await telemetry.recordStage('http-bind', 500);
  await telemetry.recordStage('webui-load', 2000);
  await telemetry.recordStage('total', 7600);
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  assert.ok(metrics.stageMetrics, 'Should have stage metrics');
  assert.ok(metrics.stageMetrics['binary-check'], 'Should have binary-check metrics');
  assert.ok(metrics.stageMetrics['model-load'], 'Should have model-load metrics');
  assert.ok(metrics.stageMetrics['total'], 'Should have total metrics');
  assert.ok(metrics.overallStats, 'Should have overall stats');
  assert.ok(Array.isArray(metrics.trend), 'Should have trend array');
  assert.strictEqual(metrics.days, 30, 'Should have 30 days');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Get metrics test passed');
}

/**
 * Test: Metrics caching
 */
async function testMetricsCaching() {
  console.log('Testing metrics caching...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-cache.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record a stage
  await telemetry.recordStage('test', 100);
  
  // Get metrics twice
  const metrics1 = await telemetry.getMetrics(30);
  const metrics2 = await telemetry.getMetrics(30);
  
  // Should be the same object (cached)
  assert.strictEqual(metrics1, metrics2, 'Should return cached metrics');
  
  // Record another stage
  await telemetry.recordStage('test', 200);
  
  // Get metrics again
  const metrics3 = await telemetry.getMetrics(30);
  
  // Should be different object (cache invalidated)
  assert.notStrictEqual(metrics1, metrics3, 'Should invalidate cache after new record');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Metrics caching test passed');
}

/**
 * Test: Slow startup warning
 */
async function testSlowStartupWarning() {
  console.log('Testing slow startup warning...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-slow.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath, { slowStartupThresholdMs: 5000 });
  await telemetry.initialize();
  
  // Track emitted events
  let slowWarningEmitted = false;
  telemetry.on('startup-slow', (warning) => {
    slowWarningEmitted = true;
    assert.ok(warning.duration > 5000, 'Duration should exceed threshold');
    assert.strictEqual(warning.threshold, 5000);
  });
  
  // Record a slow startup
  await telemetry.recordStage('total', 10000);
  
  assert.ok(slowWarningEmitted, 'Should emit startup-slow event');
  
  // Get slow startup warning
  const warning = await telemetry.getSlowStartupWarning();
  assert.ok(warning, 'Should return slow startup warning');
  assert.strictEqual(warning.duration, 10000);
  assert.strictEqual(warning.excess, 5000);
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Slow startup warning test passed');
}

/**
 * Test: No slow startup warning for fast startup
 */
async function testNoSlowStartupWarning() {
  console.log('Testing no slow startup warning for fast startup...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-fast.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath, { slowStartupThresholdMs: 5000 });
  await telemetry.initialize();
  
  // Track emitted events
  let slowWarningEmitted = false;
  telemetry.on('startup-slow', () => {
    slowWarningEmitted = true;
  });
  
  // Record a fast startup
  await telemetry.recordStage('total', 3000);
  
  assert.ok(!slowWarningEmitted, 'Should not emit startup-slow event');
  
  // Get slow startup warning
  const warning = await telemetry.getSlowStartupWarning();
  assert.ok(!warning, 'Should not return slow startup warning');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ No slow startup warning test passed');
}

/**
 * Test: Get trend analysis
 */
async function testGetTrendAnalysis() {
  console.log('Testing get trend analysis...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-trend.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record multiple startups
  for (let i = 0; i < 5; i++) {
    await telemetry.recordStage('total', 5000 + i * 100);
  }
  
  // Get trend
  const trend = await telemetry.getTrendAnalysis();
  
  assert.ok(Array.isArray(trend), 'Should return array');
  assert.ok(trend.length > 0, 'Should have trend data');
  
  // Check trend structure
  for (const entry of trend) {
    assert.ok(entry.date, 'Should have date');
    assert.ok(typeof entry.avgDuration === 'number', 'Should have avgDuration');
    assert.ok(typeof entry.count === 'number', 'Should have count');
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Get trend analysis test passed');
}

/**
 * Test: Cleanup old records
 */
async function testCleanupOldRecords() {
  console.log('Testing cleanup old records...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-cleanup.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath, { retentionDays: 1 });
  await telemetry.initialize();
  
  // Record a stage
  await telemetry.recordStage('test', 100);
  
  // Get initial stats
  let stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 1, 'Should have 1 record');
  
  // Cleanup (should not delete recent records)
  const deleted = await telemetry.cleanupOldRecords();
  assert.strictEqual(deleted, 0, 'Should not delete recent records');
  
  // Verify record still exists
  stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 1, 'Should still have 1 record');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Cleanup old records test passed');
}

/**
 * Test: Get database statistics
 */
async function testGetStats() {
  console.log('Testing get database statistics...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-db-stats.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record stages
  await telemetry.recordStage('binary-check', 100);
  await telemetry.recordStage('model-load', 5000);
  await telemetry.recordStage('total', 5100);
  
  // Get stats
  const stats = await telemetry.getStats();
  
  assert.strictEqual(stats.totalRecords, 3, 'Should have 3 records');
  assert.strictEqual(stats.uniqueStages, 3, 'Should have 3 unique stages');
  assert.ok(stats.oldestRecord, 'Should have oldest record');
  assert.ok(stats.newestRecord, 'Should have newest record');
  assert.ok(stats.dbPath, 'Should have db path');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Get database statistics test passed');
}

/**
 * Test: Reset telemetry
 */
async function testReset() {
  console.log('Testing reset telemetry...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-reset.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record stages
  await telemetry.recordStage('test', 100);
  
  // Verify record exists
  let stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 1, 'Should have 1 record');
  
  // Reset
  await telemetry.reset();
  
  // Verify records are deleted
  stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 0, 'Should have 0 records after reset');
  
  // Verify current session is reset
  assert.deepStrictEqual(telemetry.currentSession.stages, {}, 'Current session stages should be empty');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Reset telemetry test passed');
}

/**
 * Test: Multiple startup sessions
 */
async function testMultipleStartupSessions() {
  console.log('Testing multiple startup sessions...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-sessions.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Simulate multiple startup sessions
  for (let session = 0; session < 3; session++) {
    await telemetry.recordStage('binary-check', 100 + session * 10);
    await telemetry.recordStage('model-load', 5000 + session * 100);
    await telemetry.recordStage('total', 5100 + session * 110);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  assert.strictEqual(metrics.recordCount, 9, 'Should have 9 records (3 sessions × 3 stages)');
  assert.strictEqual(metrics.stageMetrics['binary-check'].count, 3, 'Should have 3 binary-check records');
  assert.strictEqual(metrics.stageMetrics['model-load'].count, 3, 'Should have 3 model-load records');
  assert.strictEqual(metrics.stageMetrics['total'].count, 3, 'Should have 3 total records');
  
  // Verify statistics
  const totalStats = metrics.stageMetrics['total'];
  assert.strictEqual(totalStats.min, 5100, 'Min total should be 5100');
  assert.strictEqual(totalStats.max, 5320, 'Max total should be 5320');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Multiple startup sessions test passed');
}

/**
 * Test: Percentile calculation
 */
async function testPercentileCalculation() {
  console.log('Testing percentile calculation...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-percentile.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record 20 values: 1-20
  for (let i = 1; i <= 20; i++) {
    await telemetry.recordStage('test', i * 100);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  const stats = metrics.stageMetrics['test'];
  
  assert.strictEqual(stats.count, 20, 'Should have 20 records');
  assert.strictEqual(stats.min, 100, 'Min should be 100');
  assert.strictEqual(stats.max, 2000, 'Max should be 2000');
  
  // P95 should be around 1900-2000
  assert.ok(stats.p95 >= 1800, 'P95 should be >= 1800');
  assert.ok(stats.p95 <= 2000, 'P95 should be <= 2000');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Percentile calculation test passed');
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('Starting StartupTelemetry tests...\n');
  
  try {
    await testStartupTelemetryInitialization();
    await testRecordStage();
    await testRecordStageWithMetadata();
    await testInvalidStageParameters();
    await testComputeStageStats();
    await testGetMetrics();
    await testMetricsCaching();
    await testSlowStartupWarning();
    await testNoSlowStartupWarning();
    await testGetTrendAnalysis();
    await testCleanupOldRecords();
    await testGetStats();
    await testReset();
    await testMultipleStartupSessions();
    await testPercentileCalculation();
    
    console.log('\n✓ All StartupTelemetry tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
