/* eslint-env node, mocha */
/**
 * Property Test P52: `autoTuneNgl` allocation-pressure monotonicity
 *
 * For any pair of pressures `a1, a2` with `a1 <= a2` and all other inputs
 * equal,
 * `autoTuneNgl(meta, args, budget, totalLayers, a1) >= autoTuneNgl(meta, args, budget, totalLayers, a2)`.
 *
 * Validates: Requirements 7 (property P52)
 *
 * Strategy:
 *   - Draw two `activeAllocationsMB` arrays where the sum of `a2` is
 *     greater than or equal to the sum of `a1`.
 *   - Compute autoTuneNgl for both allocation pressures with identical
 *     other inputs.
 *   - Assert that the result is non-increasing in allocation pressure.
 *   - Run 200 iterations per the design's testing strategy (Req 7 / P52).
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl, buildEstimateInput } = require('../../ngl-optimizer.js');
const { canFit } = require('../../vram-budget-manager.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

/**
 * Sum of an array of numbers.
 * @param {number[]} arr
 * @returns {number}
 */
function sum(arr) {
  return arr.reduce((acc, v) => acc + v, 0);
}

describe('P52: autoTuneNgl allocation-pressure monotonicity (Req 7 / P52)', () => {
  it('returns non-increasing values as activeAllocationsMB increases', () => {
    // Generate pairs of allocation arrays where sum(a2) >= sum(a1).
    const arbMonotoneAllocationPair = fc
      .tuple(
        fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
        fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
      )
      .filter(([a1, a2]) => sum(a1) <= sum(a2))
      .map(([a1, a2]) => ({ a1, a2 }));

    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(b.totalVramMB, 1024) })),
      totalLayers: fc.integer({ min: 1, max: 100 }),
      allocationPair: arbMonotoneAllocationPair,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, allocationPair }) => {
        const { a1, a2 } = allocationPair;

        const resultLow = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, a1);
        const resultHigh = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, a2);

        // Anti-monotonicity: sum(a2) >= sum(a1) → resultHigh <= resultLow
        expect(resultHigh).to.be.at.most(resultLow);
      }),
      { numRuns: 200 }, // Req 7 / P52: 200 runs
    );
  });

  it('returns the same value when activeAllocationsMB is equal', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true })),
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result1 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
        const result2 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Determinism: same inputs → same result
        expect(result1).to.equal(result2);
      }),
      { numRuns: 200 },
    );
  });

  it('returns totalLayers when activeAllocationsMB is empty and model fits', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const hugeBudget = {
          detected: true,
          totalVramMB: 128 * 1024, // 128 GiB
          reservedMB: 0,
          gpuCount: 1,
          physicalCores: 8,
        };

        // First check if totalLayers actually fits with this budget
        const cfgFull = buildEstimateInput(modelMeta, baseArgs, totalLayers);
        const ctx = {
          detected: true,
          totalMB: hugeBudget.totalVramMB,
          reservedMB: hugeBudget.reservedMB,
          activeAllocationsMB: [],
        };
        const fitResult = canFit(cfgFull, ctx);

        const result = autoTuneNgl(modelMeta, baseArgs, hugeBudget, totalLayers, []);

        // If totalLayers fits, autoTuneNgl should return totalLayers
        if (fitResult.ok === true) {
          expect(result).to.equal(totalLayers, `autoTuneNgl should return totalLayers when canFit(totalLayers) is ok:true`);
        }
        // Otherwise, result should be less than totalLayers
        else {
          expect(result).to.be.lessThan(totalLayers);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns fewer layers when activeAllocationsMB is high', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0),
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 10, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const budget = {
          detected: true,
          totalVramMB: 16 * 1024, // 16 GiB
          reservedMB: 512,
          gpuCount: 1,
          physicalCores: 8,
        };

        const resultNoAllocs = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, []);
        const resultHighAllocs = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, [8 * 1024]); // 8 GiB allocated

        // With high allocations, fewer layers should fit
        expect(resultHighAllocs).to.be.at.most(resultNoAllocs);
      }),
      { numRuns: 200 },
    );
  });
});
