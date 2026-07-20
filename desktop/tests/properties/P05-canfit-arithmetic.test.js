/**
 * Property Test P5: canFit arithmetic correctness
 *
 * For any (totalMB, reservedMB, activeAllocationsMB, required) with totalMB >= 0 and reservedMB >= 0,
 * canFit({ ..., requiredMB: required }, { totalMB, reservedMB, activeAllocationsMB })
 * returns { ok: true } iff sum(activeAllocationsMB) + required + reservedMB <= totalMB.
 * When detection indicates detected == false, canFit returns { ok: true } regardless of the inputs.
 *
 * Validates: Requirements 4.2, 4.5, 4.6
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { canFit } = require('../../vram-budget-manager');

describe('P5: canFit arithmetic correctness', () => {
  it('should return ok:true iff sum(activeAllocationsMB) + estimatedRequiredMB + reservedMB <= totalMB', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }), // totalMB
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 100000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 32768 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (totalMB, reservedMB, activeAllocationsMB, modelFileSizeMB, ctxSize, quantization) => {
          const config = {
            modelFileSizeMB,
            ctxSize,
            quantization,
            purpose: 'primary',
          };

          const context = {
            totalMB,
            reservedMB,
            activeAllocationsMB,
            detected: true,
          };

          const result = canFit(config, context);

          // Calculate expected result
          // estimateRequiredMB is calculated by the function
          const { estimateRequiredMB } = require('../../vram-budget-manager');
          const estimatedRequired = estimateRequiredMB(config);
          const activeTotal = activeAllocationsMB.reduce((sum, mb) => sum + mb, 0);
          const needed = activeTotal + estimatedRequired + reservedMB;
          const expectedOk = needed <= totalMB;

          // Assert
          expect(result.ok).to.equal(expectedOk);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should return ok:true when detection is false, regardless of inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000000 }), // totalMB
        fc.integer({ min: 0, max: 10000 }), // reservedMB
        fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 5 }), // activeAllocationsMB
        fc.integer({ min: 0, max: 100000 }), // required
        (totalMB, reservedMB, activeAllocationsMB, required) => {
          const config = {
            modelFileSizeMB: 0,
            ctxSize: 4096,
            quantization: 'f32',
            purpose: 'primary',
            requiredMB: required,
          };

          const context = {
            totalMB,
            reservedMB,
            activeAllocationsMB,
            detected: false, // Detection failed
          };

          const result = canFit(config, context);

          // When detected is false, should always return ok:true
          expect(result.ok).to.be.true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle edge case: totalMB = 0', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 4096,
      quantization: 'f32',
      purpose: 'primary',
    };

    const context = {
      totalMB: 0,
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    const result = canFit(config, context);

    // estimateRequiredMB will be > 0, so 0 + estimatedRequired + 512 > 0, so should not fit
    expect(result.ok).to.be.false;
  });

  it('should handle edge case: exact fit', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const context = {
      totalMB: 612,
      reservedMB: 512,
      activeAllocationsMB: [],
      detected: true,
    };

    const result = canFit(config, context);

    // estimateRequiredMB will be 100 + (512 * 4 / 1024 / 1024) + 0 ≈ 100.002
    // 0 + 100.002 + 512 ≈ 612.002 > 612, so should not fit
    // But let's just check that the arithmetic is correct
    const { estimateRequiredMB } = require('../../vram-budget-manager');
    const estimated = estimateRequiredMB(config);
    const needed = 0 + estimated + 512;
    expect(result.ok).to.equal(needed <= 612);
  });

  it('should handle edge case: multiple active allocations', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const context = {
      totalMB: 1000,
      reservedMB: 512,
      activeAllocationsMB: [100, 100, 100], // sum = 300
      detected: true,
    };

    const result = canFit(config, context);

    // 300 + estimatedRequired + 512 should be checked
    const { estimateRequiredMB } = require('../../vram-budget-manager');
    const estimated = estimateRequiredMB(config);
    const needed = 300 + estimated + 512;
    expect(result.ok).to.equal(needed <= 1000);
  });

  it('should handle edge case: multiple active allocations exceeding budget', () => {
    const config = {
      modelFileSizeMB: 100,
      ctxSize: 512,
      quantization: 'f32',
      purpose: 'primary',
    };

    const context = {
      totalMB: 1000,
      reservedMB: 512,
      activeAllocationsMB: [200, 200, 200], // sum = 600
      detected: true,
    };

    const result = canFit(config, context);

    // 600 + estimatedRequired + 512 should exceed 1000
    const { estimateRequiredMB } = require('../../vram-budget-manager');
    const estimated = estimateRequiredMB(config);
    const needed = 600 + estimated + 512;
    expect(result.ok).to.equal(needed <= 1000);
  });
});
