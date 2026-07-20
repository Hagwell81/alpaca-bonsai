/* eslint-env node, mocha */
/**
 * Property Test P62: `recommendPreset` determinism
 *
 * For any fixed `(modelMeta, budget)` input tuple, two successive calls to
 * `recommendPreset(...)` return objects that are deep-equal.
 *
 * Validates: Requirements 9.9
 *
 * Strategy:
 *   - Draw arbitrary `ModelMeta` and `Budget` values.
 *   - Call `recommendPreset` twice with the same inputs.
 *   - Assert that the results are deep-equal.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { recommendPreset } = require('../../preset-recommender.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P62: recommendPreset determinism (Req 9.9)', () => {
  it('returns deep-equal presets on successive calls', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset1 = recommendPreset(modelMeta, budget);
        const preset2 = recommendPreset(modelMeta, budget);

        // Determinism: same inputs → deep-equal results
        expect(preset1).to.deep.equal(preset2);
      }),
      { numRuns: 100 },
    );
  });

  it('returns identical presets across multiple calls', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset1 = recommendPreset(modelMeta, budget);
        const preset2 = recommendPreset(modelMeta, budget);
        const preset3 = recommendPreset(modelMeta, budget);

        // All presets should be deep-equal
        expect(preset1).to.deep.equal(preset2);
        expect(preset2).to.deep.equal(preset3);
      }),
      { numRuns: 100 },
    );
  });

  it('returns the same preset for identical inputs with different object references', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        // Create deep copies to ensure different object references
        const modelMetaCopy = JSON.parse(JSON.stringify(modelMeta));
        const budgetCopy = JSON.parse(JSON.stringify(budget));

        const preset1 = recommendPreset(modelMeta, budget);
        const preset2 = recommendPreset(modelMetaCopy, budgetCopy);

        // Presets should be deep-equal even with different object references
        expect(preset1).to.deep.equal(preset2);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic for edge cases', () => {
    const edgeCases = [
      { modelMeta: null, budget: null },
      { modelMeta: undefined, budget: undefined },
      { modelMeta: {}, budget: {} },
      {
        modelMeta: { filename: 'test.gguf', sizeBytes: 0, totalLayers: 0 },
        budget: { detected: false, totalVramMB: 0, reservedMB: 0, gpuCount: 0, physicalCores: 0 },
      },
    ];

    for (const { modelMeta, budget } of edgeCases) {
      const preset1 = recommendPreset(modelMeta, budget);
      const preset2 = recommendPreset(modelMeta, budget);
      expect(preset1).to.deep.equal(preset2);
    }
  });
});
