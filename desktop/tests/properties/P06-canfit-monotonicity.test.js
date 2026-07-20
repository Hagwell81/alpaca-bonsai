/**
 * Property Test P6: canFit monotonicity
 *
 * For any (totalMB, reservedMB, activeAllocationsMB) with totalMB >= reservedMB,
 * and for any pair of configurations (cfg1, cfg2) where cfg2.requiredMB <= cfg1.requiredMB,
 * if canFit(cfg1, ctx).ok is true then canFit(cfg2, ctx).ok is also true.
 *
 * Validates: Requirements 4.7
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { canFit, estimateRequiredMB } = require('../../vram-budget-manager');

describe('P6: canFit monotonicity', () => {
  it('should be monotonic: if cfg1 fits and cfg2 requires less, then cfg2 fits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 1000000 }), // totalMB (>= reservedMB)
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 100000 }), // modelFileSizeMB1
        fc.integer({ min: 512, max: 32768 }), // ctxSize1
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB, reservedMB, activeAllocationsMB, modelFileSizeMB1, ctxSize1, quantization) => {
          // Ensure totalMB >= reservedMB
          const adjustedTotalMB = Math.max(totalMB, reservedMB + 1);

          const config1 = {
            modelFileSizeMB: modelFileSizeMB1,
            ctxSize: ctxSize1,
            quantization,
            purpose: 'primary',
          };

          // Create config2 that requires less VRAM than config1
          const config2 = {
            modelFileSizeMB: Math.max(0, modelFileSizeMB1 - 100),
            ctxSize: Math.max(512, ctxSize1 - 512),
            quantization,
            purpose: 'primary',
          };

          const context = {
            totalMB: adjustedTotalMB,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const result1 = canFit(config1, context);
          const result2 = canFit(config2, context);

          // If config1 fits, config2 should also fit (since it requires less)
          if (result1.ok) {
            expect(result2.ok).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be monotonic: reducing context size should not make it worse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 1000000 }), // totalMB
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB
        fc.integer({ min: 1024, max: 32768 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB, reservedMB, activeAllocationsMB, modelFileSizeMB, ctxSize, quantization) => {
          const adjustedTotalMB = Math.max(totalMB, reservedMB + 1);

          const configLargeCtx = {
            modelFileSizeMB,
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const configSmallCtx = {
            modelFileSizeMB,
            ctxSize: Math.floor(ctxSize / 2),
            quantization,
            purpose: 'primary',
          };

          const context = {
            totalMB: adjustedTotalMB,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const resultLarge = canFit(configLargeCtx, context);
          const resultSmall = canFit(configSmallCtx, context);

          // If large context fits, small context should also fit
          if (resultLarge.ok) {
            expect(resultSmall.ok).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be monotonic: reducing model size should not make it worse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 1000000 }), // totalMB
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 1000, max: 100000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 8192 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB, reservedMB, activeAllocationsMB, modelFileSizeMB, ctxSize, quantization) => {
          const adjustedTotalMB = Math.max(totalMB, reservedMB + 1);

          const configLargeModel = {
            modelFileSizeMB,
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const configSmallModel = {
            modelFileSizeMB: Math.max(0, modelFileSizeMB - 500),
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const context = {
            totalMB: adjustedTotalMB,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const resultLarge = canFit(configLargeModel, context);
          const resultSmall = canFit(configSmallModel, context);

          // If large model fits, small model should also fit
          if (resultLarge.ok) {
            expect(resultSmall.ok).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be monotonic: reducing active allocations should not make it worse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 1000000 }), // totalMB
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 1, maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 8192 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB, reservedMB, activeAllocationsMB, modelFileSizeMB, ctxSize, quantization) => {
          const adjustedTotalMB = Math.max(totalMB, reservedMB + 1);

          const config = {
            modelFileSizeMB,
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const contextHighAlloc = {
            totalMB: adjustedTotalMB,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          // Reduce active allocations by half
          const reducedAllocations = activeAllocationsMB.map(mb => Math.floor(mb / 2));
          const contextLowAlloc = {
            totalMB: adjustedTotalMB,
            reservedMB,
            activeAllocationsMB: reducedAllocations,
            detected: true,
          };

          const resultHigh = canFit(config, contextHighAlloc);
          const resultLow = canFit(config, contextLowAlloc);

          // If it fits with high allocations, it should fit with low allocations
          if (resultHigh.ok) {
            expect(resultLow.ok).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be monotonic: increasing total VRAM should not make it worse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 512, max: 500000 }), // totalMB1
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 8192 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB1, reservedMB, activeAllocationsMB, modelFileSizeMB, ctxSize, quantization) => {
          const adjustedTotalMB1 = Math.max(totalMB1, reservedMB + 1);
          const totalMB2 = adjustedTotalMB1 + 100000; // More VRAM

          const config = {
            modelFileSizeMB,
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const contextLessVram = {
            totalMB: adjustedTotalMB1,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const contextMoreVram = {
            totalMB: totalMB2,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const resultLess = canFit(config, contextLessVram);
          const resultMore = canFit(config, contextMoreVram);

          // If it fits with less VRAM, it should fit with more VRAM
          if (resultLess.ok) {
            expect(resultMore.ok).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle edge case: exact fit boundary', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const requiredMB = estimateRequiredMB(config);

    // Context where it exactly fits
    const contextExactFit = {
      totalMB: requiredMB + 512, // reserved
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    // Context where it fits with room to spare
    const contextWithRoom = {
      totalMB: requiredMB + 512 + 1000,
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    const resultExact = canFit(config, contextExactFit);
    const resultRoom = canFit(config, contextWithRoom);

    // Both should fit
    expect(resultExact.ok).to.be.true;
    expect(resultRoom.ok).to.be.true;
  });

  it('should handle edge case: just over budget', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const requiredMB = estimateRequiredMB(config);

    // Context where it just doesn't fit
    const contextJustOver = {
      totalMB: requiredMB + 512 - 1, // Just under the required amount
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    // Context where it fits
    const contextFits = {
      totalMB: requiredMB + 512,
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    const resultOver = canFit(config, contextJustOver);
    const resultFits = canFit(config, contextFits);

    // If it fits, the one with more VRAM should also fit
    if (resultFits.ok) {
      expect(resultOver.ok).to.be.false; // This one doesn't fit
    }
  });

  it('should be monotonic when detection is false', () => {
    const config1 = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const config2 = {
      modelFileSizeMB: 50,
      ctxSize: 256,
      quantization: 'f32',
      purpose: 'primary',
    };

    const context = {
      totalMB: 0,
      reservedMB: 0,
      activeAllocationsMB: [],
      detected: false,
    };

    const result1 = canFit(config1, context);
    const result2 = canFit(config2, context);

    // Both should return ok:true when detection is false
    expect(result1.ok).to.be.true;
    expect(result2.ok).to.be.true;
  });
});
