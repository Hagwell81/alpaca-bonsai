/* eslint-env node, mocha */
/**
 * Property Test P51: `autoTuneNgl` budget monotonicity
 *
 * For any pair of budgets `b1, b2` with `b2.totalVramMB >= b1.totalVramMB`
 * and all other inputs equal,
 * `autoTuneNgl(meta, args, b2, totalLayers, active) >= autoTuneNgl(meta, args, b1, totalLayers, active)`.
 *
 * Validates: Requirements 7 (property P51)
 *
 * Strategy:
 *   - Draw a base budget and two totalVramMB values in ascending order.
 *   - Compute autoTuneNgl for both budgets with identical other inputs.
 *   - Assert that the result is non-decreasing in totalVramMB.
 *   - Run 200 iterations per the design's testing strategy (Req 7 / P51).
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl } = require('../../ngl-optimizer.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P51: autoTuneNgl budget monotonicity (Req 7 / P51)', () => {
  it('returns non-decreasing values as totalVramMB increases', () => {
    // Generate pairs of budgets that differ only in totalVramMB.
    // Filter out cases where b1.totalVramMB <= 0, as those trigger the
    // permissive fallback (Req 7.8) and are not part of the normal
    // monotonic behavior (P51 applies to positive budgets only).
    const arbMonotoneBudgetPair = arbBudget.chain((baseBudget) => {
      return fc
        .tuple(
          fc.integer({ min: 1, max: 128 * 1024 }),  // Start from 1, not 0
          fc.integer({ min: 1, max: 128 * 1024 }),
        )
        .filter(([v1, v2]) => v1 <= v2)
        .map(([vramLow, vramHigh]) => ({
          b1: { ...baseBudget, totalVramMB: vramLow, detected: true },
          b2: { ...baseBudget, totalVramMB: vramHigh, detected: true },
        }));
    });

    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budgetPair: arbMonotoneBudgetPair,
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budgetPair, totalLayers, activeAllocationsMB }) => {
        const { b1, b2 } = budgetPair;

        const resultLow = autoTuneNgl(modelMeta, baseArgs, b1, totalLayers, activeAllocationsMB);
        const resultHigh = autoTuneNgl(modelMeta, baseArgs, b2, totalLayers, activeAllocationsMB);

        // Monotonicity: b2.totalVramMB >= b1.totalVramMB → resultHigh >= resultLow
        expect(resultHigh).to.be.at.least(resultLow);
      }),
      { numRuns: 200 }, // Req 7 / P51: 200 runs
    );
  });

  it('returns the same value when totalVramMB is equal', () => {
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

  it('returns totalLayers when budget is very large', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const hugeBudget = {
          detected: true,
          totalVramMB: 1024 * 1024, // 1 TiB
          reservedMB: 0,
          gpuCount: 1,
          physicalCores: 8,
        };

        const result = autoTuneNgl(modelMeta, baseArgs, hugeBudget, totalLayers, []);

        // With a huge budget, all layers should fit
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 200 },
    );
  });

  it('returns 0 when budget is zero', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const zeroBudget = {
          detected: true,
          totalVramMB: 0,
          reservedMB: 0,
          gpuCount: 1,
          physicalCores: 8,
        };

        const result = autoTuneNgl(modelMeta, baseArgs, zeroBudget, totalLayers, []);

        // With zero budget, the permissive fallback returns totalLayers
        // (Req 7.8: totalVramMB <= 0 → return totalLayers)
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 200 },
    );
  });
});
