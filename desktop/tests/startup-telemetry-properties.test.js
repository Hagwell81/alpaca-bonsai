/* eslint-env node */
/**
 * Property-Based Tests for StartupTelemetry
 *
 * Tests core properties that should hold for all inputs.
 * Run with: node desktop/tests/startup-telemetry-properties.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { StartupTelemetry } = require('../startup-telemetry');

// Use temporary directory for test databases
const tempDir = path.join(os.tmpdir(), 'startup-telemetry-properties-tests');

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
 * Generate random integer between min and max
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Property Test: Recorded stages are retrievable in metrics
 * 
 * **Validates: Requirements 3.4.3, 3.4.4**
 * 
 * For all recorded stages, the metrics should contain those stages
 * with correct count and statistics.
 */
async function propertyRecordedStagesRetrievable() {
  console.log('Property: Recorded stages are retrievable in metrics...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-retrievable.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Test with 50 random stage recordings
  const stages = ['binary-check', 'model-load', 'http-bind', 'webui-load', 'total'];
  const recordedStages = {};
  
  for (let i = 0; i < 50; i++) {
    const stage = stages[randomInt(0, stages.length - 1)];
    const duration = randomInt(100, 10000);
    
    if (!recordedStages[stage]) {
      recordedStages[stage] = [];
    }
    recordedStages[stage].push(duration);
    
    await telemetry.recordStage(stage, duration);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  // Verify all recorded stages are in metrics
  for (const [stage, durations] of Object.entries(recordedStages)) {
    assert.ok(metrics.stageMetrics[stage], `Stage ${stage} should be in metrics`);
    assert.strictEqual(
      metrics.stageMetrics[stage].count,
      durations.length,
      `Stage ${stage} count should match recorded count`
    );
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Recorded stages are retrievable in metrics');
}

/**
 * Property Test: Metrics statistics are within recorded range
 * 
 * **Validates: Requirements 3.4.5**
 * 
 * For all recorded durations, min <= average <= max and min <= p95 <= max
 */
async function propertyMetricsWithinRange() {
  console.log('Property: Metrics statistics are within recorded range...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-within-range.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Test with 100 random durations
  const durations = [];
  for (let i = 0; i < 100; i++) {
    const duration = randomInt(100, 10000);
    durations.push(duration);
    await telemetry.recordStage('test', duration);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  const stats = metrics.stageMetrics['test'];
  
  // Verify statistics are within range
  assert.ok(stats.min >= Math.min(...durations), 'Min should be >= actual min');
  assert.ok(stats.max <= Math.max(...durations), 'Max should be <= actual max');
  assert.ok(stats.average >= stats.min, 'Average should be >= min');
  assert.ok(stats.average <= stats.max, 'Average should be <= max');
  assert.ok(stats.p95 >= stats.min, 'P95 should be >= min');
  assert.ok(stats.p95 <= stats.max, 'P95 should be <= max');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Metrics statistics are within recorded range');
}

/**
 * Property Test: Trend analysis contains all recorded days
 * 
 * **Validates: Requirements 3.4.6**
 * 
 * For all recorded total stages, trend analysis should contain entries
 * for each day with recorded data.
 */
async function propertyTrendContainsAllDays() {
  console.log('Property: Trend analysis contains all recorded days...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-trend-days.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Record multiple total stages
  for (let i = 0; i < 20; i++) {
    await telemetry.recordStage('total', randomInt(5000, 10000));
  }
  
  // Get trend
  const trend = await telemetry.getTrendAnalysis();
  
  // Verify trend has entries
  assert.ok(trend.length > 0, 'Trend should have entries');
  
  // Verify all entries have required fields
  for (const entry of trend) {
    assert.ok(entry.date, 'Entry should have date');
    assert.ok(typeof entry.avgDuration === 'number', 'Entry should have avgDuration');
    assert.ok(typeof entry.count === 'number', 'Entry should have count');
    assert.ok(entry.count > 0, 'Entry count should be positive');
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Trend analysis contains all recorded days');
}

/**
 * Property Test: Slow startup warning threshold is respected
 * 
 * **Validates: Requirements 3.4.7**
 * 
 * For all recorded total stages, if duration > threshold, warning is emitted.
 * If duration <= threshold, no warning is emitted.
 */
async function propertySlowStartupThresholdRespected() {
  console.log('Property: Slow startup warning threshold is respected...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-slow-threshold.db');
  cleanupTestDb(dbPath);
  
  const threshold = 5000;
  const telemetry = new StartupTelemetry(dbPath, { slowStartupThresholdMs: threshold });
  await telemetry.initialize();
  
  // Track warnings
  const warnings = [];
  telemetry.on('startup-slow', (warning) => {
    warnings.push(warning);
  });
  
  // Test with 20 random durations
  let slowCount = 0;
  for (let i = 0; i < 20; i++) {
    const duration = randomInt(1000, 15000);
    await telemetry.recordStage('total', duration);
    
    if (duration > threshold) {
      slowCount++;
    }
  }
  
  // Verify warning count matches slow startup count
  assert.strictEqual(warnings.length, slowCount, 'Warning count should match slow startup count');
  
  // Verify all warnings have duration > threshold
  for (const warning of warnings) {
    assert.ok(warning.duration > threshold, 'Warning duration should exceed threshold');
    assert.strictEqual(warning.threshold, threshold, 'Warning threshold should match');
    assert.ok(warning.excess > 0, 'Warning excess should be positive');
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Slow startup warning threshold is respected');
}

/**
 * Property Test: Metrics cache is invalidated on new records
 * 
 * **Validates: Requirements 3.4.4**
 * 
 * For all new records, metrics cache should be invalidated and
 * subsequent calls should return updated metrics.
 */
async function propertyMetricsCacheInvalidation() {
  console.log('Property: Metrics cache is invalidated on new records...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-cache-invalidation.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Test with 10 iterations
  for (let iteration = 0; iteration < 10; iteration++) {
    // Record a stage
    const duration = randomInt(100, 10000);
    await telemetry.recordStage('test', duration);
    
    // Get metrics
    const metrics = await telemetry.getMetrics(30);
    
    // Verify record count matches iteration + 1
    assert.strictEqual(
      metrics.recordCount,
      iteration + 1,
      `Record count should be ${iteration + 1} after ${iteration + 1} recordings`
    );
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Metrics cache is invalidated on new records');
}

/**
 * Property Test: Per-stage statistics are consistent
 * 
 * **Validates: Requirements 3.4.5**
 * 
 * For all recorded stages, min <= median <= max and count > 0
 */
async function propertyPerStageStatisticsConsistent() {
  console.log('Property: Per-stage statistics are consistent...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-stage-stats.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  const stages = ['binary-check', 'model-load', 'http-bind', 'webui-load', 'total'];
  
  // Record multiple stages
  for (let i = 0; i < 50; i++) {
    const stage = stages[randomInt(0, stages.length - 1)];
    const duration = randomInt(100, 10000);
    await telemetry.recordStage(stage, duration);
  }
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  // Verify all stages have consistent statistics
  for (const [stage, stats] of Object.entries(metrics.stageMetrics)) {
    assert.ok(stats.count > 0, `Stage ${stage} count should be positive`);
    assert.ok(stats.min <= stats.median, `Stage ${stage} min should be <= median`);
    assert.ok(stats.median <= stats.max, `Stage ${stage} median should be <= max`);
    assert.ok(stats.min <= stats.average, `Stage ${stage} min should be <= average`);
    assert.ok(stats.average <= stats.max, `Stage ${stage} average should be <= max`);
  }
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Per-stage statistics are consistent');
}

/**
 * Property Test: Database cleanup respects retention period
 * 
 * **Validates: Requirements 3.4.6**
 * 
 * For all records within retention period, cleanup should not delete them.
 */
async function propertyCleanupRespectsRetention() {
  console.log('Property: Database cleanup respects retention period...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-cleanup-retention.db');
  cleanupTestDb(dbPath);
  
  const retentionDays = 90;
  const telemetry = new StartupTelemetry(dbPath, { retentionDays });
  await telemetry.initialize();
  
  // Record multiple stages
  for (let i = 0; i < 20; i++) {
    await telemetry.recordStage('test', randomInt(100, 10000));
  }
  
  // Get initial count
  let stats = await telemetry.getStats();
  const initialCount = stats.totalRecords;
  
  // Cleanup
  const deleted = await telemetry.cleanupOldRecords();
  
  // Verify no recent records were deleted
  assert.strictEqual(deleted, 0, 'Should not delete recent records');
  
  // Verify count unchanged
  stats = await telemetry.getStats();
  assert.strictEqual(stats.totalRecords, initialCount, 'Record count should be unchanged');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Database cleanup respects retention period');
}

/**
 * Property Test: Concurrent recordings maintain consistency
 * 
 * **Validates: Requirements 3.4.3**
 * 
 * For all concurrent recordings, final record count should equal
 * number of recordings.
 */
async function propertyConcurrentRecordingsConsistent() {
  console.log('Property: Concurrent recordings maintain consistency...');
  
  ensureTempDir();
  const dbPath = path.join(tempDir, 'prop-concurrent.db');
  cleanupTestDb(dbPath);
  
  const telemetry = new StartupTelemetry(dbPath);
  await telemetry.initialize();
  
  // Test with 50 concurrent recordings
  const promises = [];
  for (let i = 0; i < 50; i++) {
    const duration = randomInt(100, 10000);
    promises.push(telemetry.recordStage('test', duration));
  }
  
  await Promise.all(promises);
  
  // Get metrics
  const metrics = await telemetry.getMetrics(30);
  
  // Verify all recordings were recorded
  assert.strictEqual(metrics.recordCount, 50, 'Should have 50 records');
  assert.strictEqual(metrics.stageMetrics['test'].count, 50, 'Should have 50 test records');
  
  await telemetry.close();
  cleanupTestDb(dbPath);
  console.log('✓ Property: Concurrent recordings maintain consistency');
}

/**
 * Run all property tests
 */
async function runAllTests() {
  console.log('Starting StartupTelemetry property-based tests...\n');
  
  try {
    await propertyRecordedStagesRetrievable();
    await propertyMetricsWithinRange();
    await propertyTrendContainsAllDays();
    await propertySlowStartupThresholdRespected();
    await propertyMetricsCacheInvalidation();
    await propertyPerStageStatisticsConsistent();
    await propertyCleanupRespectsRetention();
    await propertyConcurrentRecordingsConsistent();
    
    console.log('\n✓ All StartupTelemetry property-based tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
