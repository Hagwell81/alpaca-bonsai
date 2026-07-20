/* eslint-env node, mocha */
/**
 * Property Test P61: `recommendPreset` validity
 *
 * For any `modelMeta` and `budget` in their documented input domains,
 * `validateAdvancedArgs(recommendPreset(modelMeta, budget)).ok == true`.
 *
 * Validates: Requirements 9.1
 *
 * Strategy:
 *   - Draw arbitrary `ModelMeta` and `Budget` values from their respective
 *     arbitraries.
 *   - Call `recommendPreset` and validate the result with `validateAdvancedArgs`.
 *   - Assert that the validation always succeeds.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { recommendPreset } = require('../../preset-recommender.js');
const { validateAdvancedArgs } = require('../../advanced-args.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P61: recommendPreset validity (Req 9.1)', () => {
  it('always returns a preset that passes validateAdvancedArgs', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);
        const validation = validateAdvancedArgs(preset);

        // Validity: the preset must always pass validation
        expect(validation.ok).to.equal(true, `validation failed: ${validation.reason}`);
      }),
      { numRuns: 100 },
    );
  });

  it('returns a preset with all required fields', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // Check that all required fields are present
        expect(preset).to.have.property('nGpuLayers');
        expect(preset).to.have.property('typeK');
        expect(preset).to.have.property('typeV');
        expect(preset).to.have.property('nCpuMoe');
        expect(preset).to.have.property('threads');
        expect(preset).to.have.property('flashAttn');
        expect(preset).to.have.property('ctxSize');
        expect(preset).to.have.property('batchSize');
        expect(preset).to.have.property('ubatchSize');
        expect(preset).to.have.property('parallel');
        expect(preset).to.have.property('splitMode');
        expect(preset).to.have.property('tensorSplit');
      }),
      { numRuns: 100 },
    );
  });

  it('returns a preset with valid nGpuLayers', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // nGpuLayers must be in [-1, 999]
        expect(preset.nGpuLayers).to.be.at.least(-1);
        expect(preset.nGpuLayers).to.be.at.most(999);
        expect(Number.isInteger(preset.nGpuLayers)).to.equal(true);
      }),
      { numRuns: 100 },
    );
  });

  it('returns a preset with valid KV cache types', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    const validKvTypes = new Set(['f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0']);

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // typeK and typeV must be valid KV cache types
        expect(validKvTypes.has(preset.typeK)).to.equal(true, `invalid typeK: ${preset.typeK}`);
        expect(validKvTypes.has(preset.typeV)).to.equal(true, `invalid typeV: ${preset.typeV}`);
      }),
      { numRuns: 100 },
    );
  });

  it('returns a preset with valid nCpuMoe', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // nCpuMoe must be in [0, 999]
        expect(preset.nCpuMoe).to.be.at.least(0);
        expect(preset.nCpuMoe).to.be.at.most(999);
        expect(Number.isInteger(preset.nCpuMoe)).to.equal(true);
      }),
      { numRuns: 100 },
    );
  });

  it('returns a preset with valid threads', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // threads must be in [1, 256]
        expect(preset.threads).to.be.at.least(1);
        expect(preset.threads).to.be.at.most(256);
        expect(Number.isInteger(preset.threads)).to.equal(true);
      }),
      { numRuns: 100 },
    );
  });

  it('handles null/undefined inputs gracefully', () => {
    const preset1 = recommendPreset(null, null);
    const preset2 = recommendPreset(undefined, undefined);
    const preset3 = recommendPreset({}, {});

    const validation1 = validateAdvancedArgs(preset1);
    const validation2 = validateAdvancedArgs(preset2);
    const validation3 = validateAdvancedArgs(preset3);

    expect(validation1.ok).to.equal(true);
    expect(validation2.ok).to.equal(true);
    expect(validation3.ok).to.equal(true);
  });
});
