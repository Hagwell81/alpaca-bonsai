/* eslint-env node, mocha */
/**
 * Property Test P64: `recommendPreset` VRAM-conditioned KV type
 *
 * For any input with `budget.totalVramMB < 12288`, the returned preset has
 * `typeK == "q8_0"` and `typeV == "q8_0"`; for `budget.totalVramMB >= 12288`,
 * both are `"f16"`.
 *
 * Validates: Requirements 9.3
 *
 * Strategy:
 *   - Draw arbitrary `ModelMeta` and `Budget` values.
 *   - Call `recommendPreset` and verify that `typeK` and `typeV` are set
 *     correctly based on the budget's `totalVramMB`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { recommendPreset } = require('../../preset-recommender.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P64: recommendPreset VRAM-conditioned KV type (Req 9.3)', () => {
  it('sets typeK=q8_0, typeV=q8_0 when totalVramMB < 12 GiB', () => {
    const arbLowVramInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget.map((b) => ({ ...b, totalVramMB: fc.sample(fc.integer({ min: 0, max: 12 * 1024 - 1 }), 1)[0] })),
    });

    fc.assert(
      fc.property(arbLowVramInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // Low VRAM → q8_0 KV cache
        expect(preset.typeK).to.equal('q8_0');
        expect(preset.typeV).to.equal('q8_0');
      }),
      { numRuns: 100 },
    );
  });

  it('sets typeK=f16, typeV=f16 when totalVramMB >= 12 GiB', () => {
    const arbHighVramInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget.map((b) => ({ ...b, totalVramMB: fc.sample(fc.integer({ min: 12 * 1024, max: 128 * 1024 }), 1)[0] })),
    });

    fc.assert(
      fc.property(arbHighVramInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // High VRAM → f16 KV cache
        expect(preset.typeK).to.equal('f16');
        expect(preset.typeV).to.equal('f16');
      }),
      { numRuns: 100 },
    );
  });

  it('uses the boundary 12 GiB exactly (< 12 GiB → q8_0, >= 12 GiB → f16)', () => {
    const modelMeta = { filename: 'test.gguf', sizeBytes: 4 * 1024 * 1024 * 1024, totalLayers: 32 };

    const budgetBelow = { detected: true, totalVramMB: 12 * 1024 - 1, reservedMB: 0, gpuCount: 1, physicalCores: 8 };
    const budgetAt = { detected: true, totalVramMB: 12 * 1024, reservedMB: 0, gpuCount: 1, physicalCores: 8 };
    const budgetAbove = { detected: true, totalVramMB: 12 * 1024 + 1, reservedMB: 0, gpuCount: 1, physicalCores: 8 };

    const presetBelow = recommendPreset(modelMeta, budgetBelow);
    const presetAt = recommendPreset(modelMeta, budgetAt);
    const presetAbove = recommendPreset(modelMeta, budgetAbove);

    expect(presetBelow.typeK).to.equal('q8_0');
    expect(presetBelow.typeV).to.equal('q8_0');

    expect(presetAt.typeK).to.equal('f16');
    expect(presetAt.typeV).to.equal('f16');

    expect(presetAbove.typeK).to.equal('f16');
    expect(presetAbove.typeV).to.equal('f16');
  });

  it('handles zero VRAM budget (defaults to q8_0)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget.map((b) => ({ ...b, totalVramMB: 0 })),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // Zero VRAM → q8_0 KV cache
        expect(preset.typeK).to.equal('q8_0');
        expect(preset.typeV).to.equal('q8_0');
      }),
      { numRuns: 100 },
    );
  });

  it('handles missing totalVramMB (defaults to q8_0)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta }) => {
        const budget = { detected: true, reservedMB: 0, gpuCount: 1, physicalCores: 8 }; // No totalVramMB

        const preset = recommendPreset(modelMeta, budget);

        // Missing totalVramMB → q8_0 KV cache
        expect(preset.typeK).to.equal('q8_0');
        expect(preset.typeV).to.equal('q8_0');
      }),
      { numRuns: 100 },
    );
  });

  it('handles very large VRAM budgets (uses f16)', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta,
      budget: arbBudget.map((b) => ({ ...b, totalVramMB: 256 * 1024 })), // 256 GiB
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, budget }) => {
        const preset = recommendPreset(modelMeta, budget);

        // Very large VRAM → f16 KV cache
        expect(preset.typeK).to.equal('f16');
        expect(preset.typeV).to.equal('f16');
      }),
      { numRuns: 100 },
    );
  });

  it('is consistent across different model classes', () => {
    const modelClasses = [
      { filename: 'llama-2-7b.gguf', isMoE: false, totalParamsB: 7 },
      { filename: 'llama-2-70b.gguf', isMoE: false, totalParamsB: 70 },
      { filename: 'Mixtral-8x7B.gguf', isMoE: true, totalParamsB: 47 },
      { filename: 'deepseek-v2.gguf', isMoE: true, totalParamsB: 236 },
    ];

    for (const modelMeta of modelClasses) {
      const budgetLow = { detected: true, totalVramMB: 8 * 1024, reservedMB: 0, gpuCount: 1, physicalCores: 8 };
      const budgetHigh = { detected: true, totalVramMB: 24 * 1024, reservedMB: 0, gpuCount: 1, physicalCores: 8 };

      const presetLow = recommendPreset(modelMeta, budgetLow);
      const presetHigh = recommendPreset(modelMeta, budgetHigh);

      expect(presetLow.typeK).to.equal('q8_0');
      expect(presetLow.typeV).to.equal('q8_0');

      expect(presetHigh.typeK).to.equal('f16');
      expect(presetHigh.typeV).to.equal('f16');
    }
  });
});
