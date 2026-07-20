/* eslint-env node, mocha */
/**
 * Property Test P63: `recommendPreset` class-conditioned structure
 *
 * For any input whose class is `"moe-small"` or `"moe-large"`, the returned
 * preset has `nCpuMoe >= 0`; for any input whose class is `"dense-small"` or
 * `"dense-large"`, the returned preset has `nCpuMoe == 0`.
 *
 * Validates: Requirements 9.4, 9.5, 9.6, 9.7, 9.8
 *
 * Strategy:
 *   - Draw arbitrary `ModelMeta` and `Budget` values.
 *   - Classify the model.
 *   - Call `recommendPreset` and verify that `nCpuMoe` is set correctly
 *     based on the model class.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { recommendPreset } = require('../../preset-recommender.js');
const { classifyModel, inferTotalLayers } = require('../../model-classifier.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P63: recommendPreset class-conditioned structure (Req 9.4, 9.5, 9.6, 9.7, 9.8)', () => {
  it('sets nCpuMoe = 0 for dense models', () => {
    const arbDenseInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => {
        const cls = classifyModel(m);
        return cls === 'dense-small' || cls === 'dense-large';
      }),
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbDenseInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // Dense models should have nCpuMoe = 0
        expect(preset.nCpuMoe).to.equal(0);
      }),
      { numRuns: 100 },
    );
  });

  it('sets nCpuMoe >= 0 for MoE models', () => {
    const arbMoeInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => {
        const cls = classifyModel(m);
        return cls === 'moe-small' || cls === 'moe-large';
      }),
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbMoeInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // MoE models should have nCpuMoe >= 0
        expect(preset.nCpuMoe).to.be.at.least(0);
      }),
      { numRuns: 100 },
    );
  });

  it('sets nGpuLayers = totalLayers for *-small models', () => {
    const arbSmallInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => {
        const cls = classifyModel(m);
        return cls === 'dense-small' || cls === 'moe-small';
      }),
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbSmallInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);
        // Mirror the implementation: recommendPreset uses inferTotalLayers,
        // not `modelMeta.totalLayers || 32`. The fallback chain depends on
        // metadata presence, filename regex, and size-bytes class, so the
        // test has to use the same resolver to stay in sync.
        const totalLayers = inferTotalLayers(modelMeta);

        // Small models should have full offload
        expect(preset.nGpuLayers).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('sets nGpuLayers via autoTuneNgl for *-large models', () => {
    const arbLargeInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => {
        const cls = classifyModel(m);
        return cls === 'dense-large' || cls === 'moe-large';
      }),
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbLargeInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);
        const totalLayers = inferTotalLayers(modelMeta);

        // Large models should have nGpuLayers in [0, totalLayers]
        expect(preset.nGpuLayers).to.be.at.least(0);
        expect(preset.nGpuLayers).to.be.at.most(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('sets flashAttn = true for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // flashAttn should always be true (Req 9.6)
        expect(preset.flashAttn).to.equal(true);
      }),
      { numRuns: 100 },
    );
  });

  it('sets ctxSize = 4096 for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // ctxSize should always be 4096 (Req 9.7)
        expect(preset.ctxSize).to.equal(4096);
      }),
      { numRuns: 100 },
    );
  });

  it('sets batchSize = 512 for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // batchSize should always be 512 (Req 9.7)
        expect(preset.batchSize).to.equal(512);
      }),
      { numRuns: 100 },
    );
  });

  it('sets ubatchSize = 512 for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // ubatchSize should always be 512 (Req 9.7)
        expect(preset.ubatchSize).to.equal(512);
      }),
      { numRuns: 100 },
    );
  });

  it('sets parallel = 1 for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // parallel should always be 1 (Req 9.7)
        expect(preset.parallel).to.equal(1);
      }),
      { numRuns: 100 },
    );
  });

  it('sets splitMode = "layer" when gpuCount > 1', () => {
    const arbMultiGpuInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget.map((b) => ({ ...b, gpuCount: fc.sample(fc.integer({ min: 2, max: 8 }), 1)[0] })),
    });

    fc.assert(
      fc.property(arbMultiGpuInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // splitMode should be 'layer' when gpuCount > 1 (Req 9.8)
        expect(preset.splitMode).to.equal('layer');
      }),
      { numRuns: 100 },
    );
  });

  it('sets tensorSplit = [] for all models', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // tensorSplit should always be empty (Req 9.8)
        expect(preset.tensorSplit).to.deep.equal([]);
      }),
      { numRuns: 100 },
    );
  });

  it('sets threads = budget.physicalCores (clamped to [1, 256])', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);
        const expectedThreads = Math.max(1, Math.min(256, budget.physicalCores || 4));

        // threads should match budget.physicalCores (clamped) (Req 9.5)
        expect(preset.threads).to.equal(expectedThreads);
      }),
      { numRuns: 100 },
    );
  });
});
