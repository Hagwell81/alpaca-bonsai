/* eslint-env node, mocha */
/**
 * Property Test P57: `autoTuneNgl` determinism and detection-failure fallback
 *
 * For any fixed input tuple, two successive calls to `autoTuneNgl(...)`
 * return the same integer. When `budget.detected === false`, the function
 * returns `totalLayers` (the permissive fallback).
 *
 * Validates: Requirements 7.5, 7.8
 *
 * Strategy:
 *   - Draw arbitrary inputs from the full input domain.
 *   - Call `autoTuneNgl` twice with the same inputs and verify the results
 *     are identical (determinism).
 *   - When `budget.detected === false`, verify that the result is `totalLayers`
 *     (permissive fallback).
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl } = require('../../ngl-optimizer.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P57: autoTuneNgl determinism and detection-failure fallback (Req 7.5, 7.8)', () => {
  it('returns the same value on successive calls (determinism)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      totalLayers: fc.integer({ min: 0, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result1 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
        const result2 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Determinism: same inputs → same result
        expect(result1).to.equal(result2);
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when budget.detected === false (permissive fallback)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: false })),
      totalLayers: fc.integer({ min: 0, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Permissive fallback: budget.detected === false → return totalLayers
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when budget.totalVramMB <= 0 (permissive fallback)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: 0 })),
      totalLayers: fc.integer({ min: 0, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Permissive fallback: budget.totalVramMB <= 0 → return totalLayers
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when budget.totalVramMB is negative (permissive fallback)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: -1024 })),
      totalLayers: fc.integer({ min: 0, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Permissive fallback: budget.totalVramMB < 0 → return totalLayers
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when budget.totalVramMB is missing (permissive fallback)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 0, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers, activeAllocationsMB }) => {
        const budget = { detected: true, reservedMB: 512 }; // No totalVramMB

        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Permissive fallback: missing totalVramMB → return totalLayers
        expect(result).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic across different call patterns', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        // Call multiple times in different patterns
        const result1 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
        const result2 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
        const result3 = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // All results should be identical
        expect(result1).to.equal(result2);
        expect(result2).to.equal(result3);
      }),
      { numRuns: 100 },
    );
  });
});
