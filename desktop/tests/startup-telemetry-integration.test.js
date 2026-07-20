/* eslint-env node */
/**
 * Integration tests for StartupTelemetry
 *
 * Run with: node desktop/tests/startup-telemetry-integration.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { StartupTelemetry } = require('../startup-telemetry');

// Use temporary directory for test databases
const tempDir = path.join(os.tmpdir(), 'startup-telemetry-integration-tests');

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
 * Integration Test: Complete startup telemetry workflow
 */
async function testCompleteStartupWorkflow() {
  console.log('Testing complete startup telemetry workflow...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-workflow.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Simulate a complete startup sequence
  const startupSequence = [
    { stage: 'binary-check', duration: 150, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' },
    { stage: 'model-load', duration: 4800 },
    { stage: 'http-bind', duration: 450 },
    { stage: 'webui-load', duration: 1800 },
    { stage: 'total', duration: 7200 }
  ];
  
  for (const { stage, duration, model, backend } of startupSequence) {
    const metadata = {};
    if (model) metadata.model = model;
    if (backend) metadata.backend = backend;
    await telemetry.recordStage(stage, duration, metadata);
  }
  
  // Verify metrics
  const metrics = await telemetry.getMetrics(30);
  
  assert.strictEqual(metrics.recordCount, 5, 'Should have 5 records');
  assert.ok(metrics.stageMetrics['binary-check'], 'Should have binary-check metrics');
  assert.ok(metrics.stageMetrics['model-load'], 'Should have model-load metrics');
  assert.ok(metrics.stageMetrics['http-bind'], 'Should have http-bind metrics');
  assert.ok(metrics.stageMetrics['webui-load'], 'Should have webui-load metrics');
  assert.ok(metrics.stageMetrics['total'], 'Should have total metrics');
  
  // Verify overall stats
  assert.ok(metrics.overallStats, 'Should have overall stats');
  assert.strictEqual(metrics.overallStats.count, 1, 'Should have 1 total startup');
  assert.strictEqual(metrics.overallStats.average, 7200, 'Average should be 7200');
  
  // Verify trend
  assert.ok(Array.isArray(metrics.trend), 'Should have trend array');
  assert.ok(metrics.trend.length > 0, 'Should have trend data');
  
  const trendEntry = metrics.trend[0];
  assert.ok(trendEntry.date, 'Trend entry should have date');
  assert.strictEqual(trendEntry.avgDuration, 7200, 'Trend average should be 7200');
  assert.strictEqual(trendEntry.count, 1, 'Trend count should be 1');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Complete startup telemetry workflow test passed');
}

/**
 * Integration Test: Multiple startup sessions with trend analysis
 */
async function testMultipleSessionsTrendAnalysis() {
  console.log('Testing multiple sessions trend analysis...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-trend-analysis.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Simulate 5 startup sessions with varying durations
  const sessions = [
    { total: 7200, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' },
    { total: 6800, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' },
    { total: 7500, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' },
    { total: 6900, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' },
    { total: 7100, model: 'Qwen3.5-9B-Q4_K_M.gguf', backend: 'cuda' }
  ];
  
  for (const session of sessions) {
    await telemetry.recordStage('total', session.total, {
      model: session.model,
      backend: session.backend
    });
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  assert.strictEqual(metrics.recordCount, 5, 'Should have 5 records');
  assert.strictEqual(metrics.stageMetrics['total'].count, 5, 'Should have 5 total records');
  
  // Verify statistics
  const totalStats = metrics.stageMetrics['total'];
  assert.strictEqual(totalStats.min, 6800, 'Min should be 6800');
  assert.strictEqual(totalStats.max, 7500, 'Max should be 7500');
  assert.ok(totalStats.average >= 6800 && totalStats.average <= 7500, 'Average should be in range');
  
  // Verify trend
  assert.ok(metrics.trend.length > 0, 'Should have trend data');
  const trendEntry = metrics.trend[0];
  assert.ok(trendEntry.avgDuration >= 6800 && trendEntry.avgDuration <= 7500, 'Trend average should be in range');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Multiple sessions trend analysis test passed');
}

/**
 * Integration Test: Slow startup detection and warning
 */
async function testSlowStartupDetection() {
  console.log('Testing slow startup detection and warning...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-slow-detection.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath, { slowStartupThresholdMs: 5000 });
  await telemetry.initialize();
  
  // Track warnings
  const warnings = [];
  telemetry.on('startup-slow', (warning) => {
    warnings.push(warning);
  });
  
  // Record a normal startup
  await telemetry.recordStage('total', 4000);
  assert.strictEqual(warnings.length, 0, 'Should not warn for normal startup');
  
  // Record a slow startup
  await telemetry.recordStage('total', 8000);
  assert.strictEqual(warnings.length, 1, 'Should warn for slow startup');
  
  // Verify warning details
  const warning = warnings[0];
  assert.strictEqual(warning.duration, 8000, 'Warning duration should be 8000');
  assert.strictEqual(warning.threshold, 5000, 'Warning threshold should be 5000');
  assert.strictEqual(warning.excess, 3000, 'Warning excess should be 3000');
  
  // Get slow startup warning
  const slowWarning = await telemetry.getSlowStartupWarning();
  assert.ok(slowWarning, 'Should return slow startup warning');
  assert.strictEqual(slowWarning.duration, 8000, 'Slow warning duration should be 8000');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Slow startup detection and warning test passed');
}

/**
 * Integration Test: Per-stage metrics computation
 */
async function testPerStageMetricsComputation() {
  console.log('Testing per-stage metrics computation...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-per-stage.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record multiple sessions with varying stage durations
  const sessions = [
    { 'binary-check': 100, 'model-load': 5000, 'http-bind': 500, 'webui-load': 2000, 'total': 7600 },
    { 'binary-check': 120, 'model-load': 4800, 'http-bind': 450, 'webui-load': 1900, 'total': 7270 },
    { 'binary-check': 110, 'model-load': 5200, 'http-bind': 480, 'webui-load': 2100, 'total': 7890 }
  ];
  
  for (const session of sessions) {
    for (const [stage, duration] of Object.entries(session)) {
      await telemetry.recordStage(stage, duration);
    }
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  // Verify per-stage metrics
  const binaryCheckStats = metrics.stageMetrics['binary-check'];
  assert.strictEqual(binaryCheckStats.count, 3, 'binary-check should have 3 records');
  assert.strictEqual(binaryCheckStats.min, 100, 'binary-check min should be 100');
  assert.strictEqual(binaryCheckStats.max, 120, 'binary-check max should be 120');
  
  const modelLoadStats = metrics.stageMetrics['model-load'];
  assert.strictEqual(modelLoadStats.count, 3, 'model-load should have 3 records');
  assert.strictEqual(modelLoadStats.min, 4800, 'model-load min should be 4800');
  assert.strictEqual(modelLoadStats.max, 5200, 'model-load max should be 5200');
  
  const totalStats = metrics.stageMetrics['total'];
  assert.strictEqual(totalStats.count, 3, 'total should have 3 records');
  assert.strictEqual(totalStats.min, 7270, 'total min should be 7270');
  assert.strictEqual(totalStats.max, 7890, 'total max should be 7890');
  
  // Verify p95 is computed
  assert.ok(totalStats.p95 >= totalStats.min && totalStats.p95 <= totalStats.max, 'p95 should be in range');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Per-stage metrics computation test passed');
}

/**
 * Integration Test: 30-day trend analysis
 */
async function testThirtyDayTrendAnalysis() {
  console.log('Testing 30-day trend analysis...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-30day-trend.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record multiple startups
  for (let i = 0; i < 10; i++) {
    await telemetry.recordStage('total', 7000 + i * 100);
  }
  
  // Get trend analysis
  const trend = await telemetry.getTrendAnalysis();
  
  assert.ok(Array.isArray(trend), 'Should return array');
  assert.ok(trend.length > 0, 'Should have trend data');
  
  // Verify trend structure
  for (const entry of trend) {
    assert.ok(entry.date, 'Should have date');
    assert.ok(typeof entry.avgDuration === 'number', 'Should have avgDuration');
    assert.ok(typeof entry.count === 'number', 'Should have count');
    assert.ok(entry.count > 0, 'Count should be positive');
  }
  
  // Verify trend is sorted by date
  for (let i = 1; i < trend.length; i++) {
    assert.ok(trend[i].date >= trend[i - 1].date, 'Trend should be sorted by date');
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ 30-day trend analysis test passed');
}

/**
 * Integration Test: Database cleanup and retention
 */
async function testDatabaseCleanupAndRetention() {
  console.log('Testing database cleanup and retention...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-cleanup-retention.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath, { retentionDays: 90 });
  await telemetry.initialize();
  
  // Record multiple startups
  for (let i = 0; i < 5; i++) {
    await telemetry.recordStage('total', 7000 + i * 100);
  }
  
  // Get initial stats
  let stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 5, 'Should have 5 records');
  
  // Cleanup (should not delete recent records)
  const deleted = await telemetry.cleanupOldRecords();
  assert.strictEqual(deleted, 0, 'Should not delete recent records');
  
  // Verify records still exist
  stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, 5, 'Should still have 5 records');
  
  // Verify database stats
  assert.ok(stats.oldestRecord, 'Should have oldest record');
  assert.ok(stats.newestRecord, 'Should have newest record');
  assert.ok(stats.uniqueStages >= 1, 'Should have at least 1 unique stage');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Database cleanup and retention test passed');
}

/**
 * Integration Test: Concurrent stage recording
 */
async function testConcurrentStageRecording() {
  console.log('Testing concurrent stage recording...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-concurrent.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record stages concurrently
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(telemetry.recordStage('test', 100 + i * 10));
  }
  
  await Promise.all(promises);
  
  // Verify all records were recorded
  const metrics = await telemetry.getMetrics(30);
  assert.strictEqual(metrics.recordCount, 10, 'Should have 10 records');
  assert.strictEqual(metrics.stageMetrics['test'].count, 10, 'Should have 10 test records');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Concurrent stage recording test passed');
}

/**
 * Integration Test: Metrics cache invalidation
 */
async function testMetricsCacheInvalidation() {
  console.log('Testing metrics cache invalidation...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'test-cache-invalidation.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record initial stage
  await telemetry.recordStage('test', 100);
  
  // Get metrics (should be cached)
  const metrics1 = await telemetry.getMetrics(30);
  assert.strictEqual(metrics1.recordCount, 1, 'Should have 1 record');
  
  // Get metrics again (should be from cache)
  const metrics2 = await telemetry.getMetrics(30);
  assert.strictEqual(metrics1, metrics2, 'Should return cached metrics');
  
  // Record another stage
  await telemetry.recordStage('test', 200);
  
  // Get metrics again (cache should be invalidated)
  const metrics3 = await telemetry.getMetrics(30);
  assert.notStrictEqual(metrics1, metrics3, 'Should return new metrics after cache invalidation');
  assert.strictEqual(metrics3.recordCount, 2, 'Should have 2 records');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Metrics cache invalidation test passed');
}

/**
 * Run all integration tests
 */
async function runAllTests() {
  console.log('Starting StartupTelemetry integration tests...\n');
  
  try {
    await testCompleteStartupWorkflow();
    await testMultipleSessionsTrendAnalysis();
    await testSlowStartupDetection();
    await testPerStageMetricsComputation();
    await testThirtyDayTrendAnalysis();
    await testDatabaseCleanupAndRetention();
    await testConcurrentStageRecording();
    await testMetricsCacheInvalidation();
    
    console.log('\n✓ All StartupTelemetry integration tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
