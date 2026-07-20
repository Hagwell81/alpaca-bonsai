/* eslint-env node */
/**
 * Property Test: VRAM Tracker Accounting Invariant (P8)
 * Property Test: Conservative VRAM Estimate (P9)
 *
 * Validates: Requirements 5.3, 8.2, 8.3, 8.4, 8.5
 */

const { describe, it } = require('mocha');
const fc = require('fast-check');
const { expect } = require('chai');
const { VramTracker, OS_OVERHEAD_MB } = require('../../vram-tracker');

describe('P8: VRAM Tracker Accounting Invariant', () => {
  it('getTotalAllocated always equals sum of registered allocations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              action: fc.constant('register'),
              modelPath: fc.string({ minLength: 1, maxLength: 20 }),
              mb: fc.integer({ min: 0, max: 10000 }),
            }),
            fc.record({
              action: fc.constant('deregister'),
              modelPath: fc.string({ minLength: 1, maxLength: 20 }),
            })
          ),
          { minLength: 1, maxLength: 50 }
        ),
        (operations) => {
          const tracker = new VramTracker(null);
          const expectedAllocations = new Map();

          for (const op of operations) {
            if (op.action === 'register') {
              tracker.registerRunner(op.modelPath, op.mb);
              expectedAllocations.set(op.modelPath, op.mb);
            } else {
              tracker.deregisterRunner(op.modelPath);
              expectedAllocations.delete(op.modelPath);
            }
          }

          let expectedSum = 0;
          for (const mb of expectedAllocations.values()) {
            expectedSum += mb;
          }

          return tracker.getTotalAllocated() === expectedSum;
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe('P9: Conservative VRAM Estimate', () => {
  it('getAvailable returns min(predicted, gpuReported)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2048, max: 64000 }), // totalMB
        fc.integer({ min: 0, max: 50 }), // number of allocations
        fc.integer({ min: 0, max: 10000 }), // gpuFreeQuery return
        (totalMB, allocCount, gpuFree) => {
          const tracker = new VramTracker(null, {
            gpuFreeQuery: () => gpuFree,
          });
          tracker.totalMB = totalMB;
          tracker.detected = true;

          let allocated = 0;
          for (let i = 0; i < allocCount; i++) {
            const mb = Math.floor(Math.random() * 1000);
            tracker.registerRunner(`model-${i}.gguf`, mb);
            allocated += mb;
          }

          const predicted = totalMB - allocated - OS_OVERHEAD_MB;
          const expected = Math.max(0, Math.min(predicted, gpuFree));
          return tracker.getAvailable() === expected;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('getAvailable returns 0 when over-allocated', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2048 }), // small totalMB
        fc.integer({ min: 3000, max: 10000 }), // gpuFreeQuery
        (totalMB, gpuFree) => {
          const tracker = new VramTracker(null, {
            gpuFreeQuery: () => gpuFree,
          });
          tracker.totalMB = totalMB;
          tracker.detected = true;
          tracker.registerRunner('huge.gguf', totalMB + 1000);

          const available = tracker.getAvailable();
          return available === 0;
        }
      ),
      { numRuns: 500 }
    );
  });
});
