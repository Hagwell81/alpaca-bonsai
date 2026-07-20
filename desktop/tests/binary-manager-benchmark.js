/* eslint-env node */
/**
 * Binary Manager Cache Hit Rate Benchmark
 * 
 * This benchmark measures cache performance for backend binary caching.
 * It simulates repeated backend lookups and measures cache hit rates.
 * 
 * Acceptance Criteria:
 * - Cache reduces re-downloads
 * - Cache eviction works correctly
 * - Cache hit rate > 80% for repeated lookups
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock Electron app
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(os.tmpdir(), 'benchmark-binary-manager');
    }
    return os.tmpdir();
  }
};

const binaryManager = require('../binary-manager');

class CacheBenchmark {
  constructor() {
    this.hits = 0;
    this.misses = 0;
    this.totalTime = 0;
    this.lookups = [];
  }

  /**
   * Simulate backend lookup with cache
   */
  simulateLookup(version, backend) {
    const startTime = Date.now();
    
    // Try to get from cache
    const cached = binaryManager.getCachedBackend(mockApp, version, backend);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    if (cached) {
      this.hits++;
    } else {
      this.misses++;
    }
    
    this.totalTime += duration;
    this.lookups.push({
      version,
      backend,
      cached: !!cached,
      duration
    });
  }

  /**
   * Run benchmark
   */
  run() {
    console.log('\n=== Binary Manager Cache Hit Rate Benchmark ===\n');
    
    // Clear cache before benchmark
    binaryManager.clearCache();
    
    // Test 1: Single backend repeated lookups
    console.log('Test 1: Single backend repeated lookups (100 iterations)');
    for (let i = 0; i < 100; i++) {
      this.simulateLookup('v1.0.0', 'win-cpu-x64');
    }
    
    // Test 2: Multiple backends with rotation
    console.log('Test 2: Multiple backends with rotation (150 iterations)');
    const backends = ['win-cpu-x64', 'win-cuda-12.4-x64', 'macos-arm64', 'ubuntu-x64'];
    for (let i = 0; i < 150; i++) {
      const backend = backends[i % backends.length];
      this.simulateLookup('v1.0.0', backend);
    }
    
    // Test 3: Multiple versions with LRU eviction
    console.log('Test 3: Multiple versions with LRU eviction (200 iterations)');
    const versions = ['v1.0.0', 'v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.0.4'];
    for (let i = 0; i < 200; i++) {
      const version = versions[i % versions.length];
      const backend = backends[i % backends.length];
      this.simulateLookup(version, backend);
    }
    
    this.printResults();
  }

  /**
   * Print benchmark results
   */
  printResults() {
    const totalLookups = this.hits + this.misses;
    const hitRate = totalLookups > 0 ? (this.hits / totalLookups * 100).toFixed(2) : 0;
    const avgTime = totalLookups > 0 ? (this.totalTime / totalLookups).toFixed(2) : 0;
    
    console.log('\n=== Benchmark Results ===\n');
    console.log(`Total Lookups:     ${totalLookups}`);
    console.log(`Cache Hits:        ${this.hits}`);
    console.log(`Cache Misses:      ${this.misses}`);
    console.log(`Hit Rate:          ${hitRate}%`);
    console.log(`Avg Lookup Time:   ${avgTime}ms`);
    console.log(`Total Time:        ${this.totalTime}ms`);
    
    // Cache statistics
    const stats = binaryManager.getCacheStats();
    console.log(`\nCache Statistics:`);
    console.log(`  Current Size:    ${stats.size}/${stats.maxSize}`);
    console.log(`  Cached Entries:  ${stats.entries.length}`);
    
    // Performance assessment
    console.log('\n=== Performance Assessment ===\n');
    if (hitRate >= 80) {
      console.log('✓ PASS: Cache hit rate >= 80%');
    } else {
      console.log(`✗ FAIL: Cache hit rate ${hitRate}% < 80%`);
    }
    
    if (avgTime < 1) {
      console.log('✓ PASS: Average lookup time < 1ms');
    } else {
      console.log(`✗ FAIL: Average lookup time ${avgTime}ms >= 1ms`);
    }
    
    if (stats.size <= stats.maxSize) {
      console.log(`✓ PASS: Cache size within limit (${stats.size}/${stats.maxSize})`);
    } else {
      console.log(`✗ FAIL: Cache size exceeds limit (${stats.size}/${stats.maxSize})`);
    }
    
    // Detailed lookup analysis
    console.log('\n=== Lookup Analysis ===\n');
    const hitsByBackend = {};
    const missesByBackend = {};
    
    this.lookups.forEach(lookup => {
      const key = `${lookup.version}/${lookup.backend}`;
      if (lookup.cached) {
        hitsByBackend[key] = (hitsByBackend[key] || 0) + 1;
      } else {
        missesByBackend[key] = (missesByBackend[key] || 0) + 1;
      }
    });
    
    console.log('Top Cache Hits:');
    Object.entries(hitsByBackend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([key, count]) => {
        console.log(`  ${key}: ${count} hits`);
      });
    
    console.log('\nCache Misses:');
    Object.entries(missesByBackend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([key, count]) => {
        console.log(`  ${key}: ${count} misses`);
      });
  }
}

// Run benchmark
if (require.main === module) {
  const benchmark = new CacheBenchmark();
  benchmark.run();
}

module.exports = CacheBenchmark;
