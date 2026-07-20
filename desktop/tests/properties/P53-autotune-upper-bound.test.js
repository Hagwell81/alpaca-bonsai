/* eslint-env node, mocha */
/**
 * Property Test P53: `autoTuneNgl` upper bound
 *
 * For any inputs, `autoTuneNgl(...)` returns a value in `[0, totalLayers]`.
 *
 * Validates: Requirements 7.1
 *
 * Strategy:
 *   - Draw arbitrary inputs from the full input domain.
 *   - Compute autoTuneNgl.
 *   - Assert that the result is in the range `[0, totalLayers]`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl } = require('../../ngl-optimizer.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P53: autoTuneNgl upper bound (Req 7.1)', () => {
  it('always returns a value in [0, totalLayers]', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      totalLayers: fc.integer({ min: 0, max: 200 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 16384 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Upper bound: result must be in [0, totalLayers]
        expect(result).to.be.at.least(0);
        expect(result).to.be.at.most(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('returns an integer', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // Result must be an integer
        expect(Number.isInteger(result)).to.equal(true);
      }),
      { numRuns: 100 },
    );
  });

  it('handles totalLayers = 0 gracefully', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, 0, activeAllocationsMB);

        // With totalLayers = 0, the only valid result is 0
        expect(result).to.equal(0);
      }),
      { numRuns: 100 },
    );
  });

  it('handles negative totalLayers gracefully (floors to 0)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, -10, activeAllocationsMB);

        // Negative totalLayers should be floored to 0
        expect(result).to.equal(0);
      }),
      { numRuns: 100 },
    );
  });

  it('handles non-integer totalLayers by flooring', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget,
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 8192 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, activeAllocationsMB }) => {
        const result = autoTuneNgl(modelMeta, baseArgs, budget, 32.7, activeAllocationsMB);

        // Non-integer totalLayers should be floored
        expect(result).to.be.at.least(0);
        expect(result).to.be.at.most(32);
      }),
      { numRuns: 100 },
    );
  });
});
