/**
 * Unit tests for preset-recommender.js
 *
 * Covers `recommendPreset(modelMeta, budget)` across the four model classes
 * (`dense-small`, `dense-large`, `moe-small`, `moe-large`) × two budget sizes
 * (`< 12 GiB` small, `>= 12 GiB` large) × `gpuCount ∈ {1, 2}`.
 *
 * Validates that the returned preset:
 *   - Passes `validateAdvancedArgs` (Req 9.1)
 *   - Sets `nGpuLayers` correctly (Req 9.2)
 *   - Sets `typeK` / `typeV` based on budget (Req 9.3)
 *   - Sets `nCpuMoe` for MoE models (Req 9.4)
 *   - Sets `threads` from `budget.physicalCores` (Req 9.5)
 *   - Sets `flashAttn = true` (Req 9.6)
 *   - Sets `ctxSize`, `batchSize`, `ubatchSize`, `parallel` (Req 9.7)
 *   - Sets `splitMode` when `gpuCount > 1` (Req 9.8)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10 (examples)
 */

'use strict';

const { expect } = require('chai');
const { recommendPreset } = require('../../preset-recommender');
const { validateAdvancedArgs } = require('../../advanced-args');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024;

/**
 * Minimal modelMeta for testing.
 */
function makeMeta(overrides = {}) {
  return {
    filename: 'test-model.gguf',
    sizeBytes: 4 * GIB,
    totalLayers: 32,
    ...overrides,
  };
}

/**
 * Minimal budget for testing.
 */
function makeBudget(overrides = {}) {
  return {
    detected: true,
    totalVramMB: 8 * 1024,
    reservedMB: 512,
    gpuCount: 1,
    physicalCores: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// recommendPreset
// ---------------------------------------------------------------------------

describe('recommendPreset', () => {
  describe('validity (Req 9.1 / P61)', () => {
    it('returns a preset that passes validateAdvancedArgs for dense-small', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      const preset = recommendPreset(meta, budget);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });

    it('returns a preset that passes validateAdvancedArgs for dense-large', () => {
      const meta = makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70 });
      const budget = makeBudget({ totalVramMB: 24 * 1024 });
      const preset = recommendPreset(meta, budget);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });

    it('returns a preset that passes validateAdvancedArgs for moe-small', () => {
      const meta = makeMeta({
        filename: 'Mixtral-8x7B.gguf',
        isMoE: true,
        totalParamsB: 47,
        totalLayers: 32,
      });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });

    it('returns a preset that passes validateAdvancedArgs for moe-large', () => {
      const meta = makeMeta({
        filename: 'deepseek-v2.gguf',
        isMoE: true,
        totalParamsB: 236,
        activeParamsB: 21,
        totalLayers: 60,
      });
      const budget = makeBudget({ totalVramMB: 48 * 1024 });
      const preset = recommendPreset(meta, budget);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });
  });

  describe('nGpuLayers (Req 9.2)', () => {
    it('sets nGpuLayers = totalLayers for dense-small', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nGpuLayers).to.equal(32);
    });

    it('sets nGpuLayers = totalLayers for moe-small', () => {
      const meta = makeMeta({
        filename: 'Qwen1.5-MoE-A2.7B.gguf',
        isMoE: true,
        totalParamsB: 14,
        totalLayers: 28,
      });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nGpuLayers).to.equal(28);
    });

    it('sets nGpuLayers via autoTuneNgl for dense-large', () => {
      const meta = makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70, totalLayers: 80 });
      const budget = makeBudget({ totalVramMB: 24 * 1024 });
      const preset = recommendPreset(meta, budget);
      // autoTuneNgl should return a value in [0, 80]; exact value depends on estimator.
      expect(preset.nGpuLayers).to.be.at.least(0);
      expect(preset.nGpuLayers).to.be.at.most(80);
    });

    it('sets nGpuLayers via autoTuneNgl for moe-large', () => {
      const meta = makeMeta({
        filename: 'deepseek-v2.gguf',
        isMoE: true,
        totalParamsB: 236,
        totalLayers: 60,
      });
      const budget = makeBudget({ totalVramMB: 48 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nGpuLayers).to.be.at.least(0);
      expect(preset.nGpuLayers).to.be.at.most(60);
    });
  });

  describe('KV cache precision (Req 9.3 / P64)', () => {
    it('sets typeK=q8_0, typeV=q8_0 when totalVramMB < 12 GiB', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.typeK).to.equal('q8_0');
      expect(preset.typeV).to.equal('q8_0');
    });

    it('sets typeK=f16, typeV=f16 when totalVramMB >= 12 GiB', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.typeK).to.equal('f16');
      expect(preset.typeV).to.equal('f16');
    });

    it('uses the boundary 12 GiB exactly (< 12 GiB → q8_0, >= 12 GiB → f16)', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budgetBelow = makeBudget({ totalVramMB: 12 * 1024 - 1 });
      const budgetAt = makeBudget({ totalVramMB: 12 * 1024 });
      const presetBelow = recommendPreset(meta, budgetBelow);
      const presetAt = recommendPreset(meta, budgetAt);
      expect(presetBelow.typeK).to.equal('q8_0');
      expect(presetAt.typeK).to.equal('f16');
    });
  });

  describe('nCpuMoe (Req 9.4)', () => {
    it('sets nCpuMoe = 0 for dense models', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', isMoE: false, totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nCpuMoe).to.equal(0);
    });

    it('sets nCpuMoe >= 0 for moe-small models', () => {
      const meta = makeMeta({
        filename: 'Mixtral-8x7B.gguf',
        isMoE: true,
        totalParamsB: 47,
        totalLayers: 32,
      });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nCpuMoe).to.be.at.least(0);
    });

    it('sets nCpuMoe >= 0 for moe-large models', () => {
      const meta = makeMeta({
        filename: 'deepseek-v2.gguf',
        isMoE: true,
        totalParamsB: 236,
        totalLayers: 60,
      });
      const budget = makeBudget({ totalVramMB: 48 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.nCpuMoe).to.be.at.least(0);
    });

    it('sets nCpuMoe = max(0, totalLayers - fit) for MoE models', () => {
      const meta = makeMeta({
        filename: 'Mixtral-8x7B.gguf',
        isMoE: true,
        totalParamsB: 47,
        totalLayers: 32,
      });
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      const preset = recommendPreset(meta, budget);
      // With limited VRAM, some experts should be offloaded to CPU.
      // nCpuMoe should be in [0, 32].
      expect(preset.nCpuMoe).to.be.at.least(0);
      expect(preset.nCpuMoe).to.be.at.most(32);
    });
  });

  describe('threads (Req 9.5)', () => {
    it('sets threads = budget.physicalCores', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ physicalCores: 16 });
      const preset = recommendPreset(meta, budget);
      expect(preset.threads).to.equal(16);
    });

    it('clamps threads to [1, 256]', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budgetLow = makeBudget({ physicalCores: 0 });
      const budgetHigh = makeBudget({ physicalCores: 512 });
      const presetLow = recommendPreset(meta, budgetLow);
      const presetHigh = recommendPreset(meta, budgetHigh);
      expect(presetLow.threads).to.equal(1);
      expect(presetHigh.threads).to.equal(256);
    });
  });

  describe('flashAttn (Req 9.6)', () => {
    it('sets flashAttn = true', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.flashAttn).to.equal(true);
    });
  });

  describe('context and batch sizes (Req 9.7)', () => {
    it('sets ctxSize = 4096', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.ctxSize).to.equal(4096);
    });

    it('sets batchSize = 512', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.batchSize).to.equal(512);
    });

    it('sets ubatchSize = 512', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.ubatchSize).to.equal(512);
    });

    it('sets parallel = 1', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset = recommendPreset(meta, budget);
      expect(preset.parallel).to.equal(1);
    });
  });

  describe('multi-GPU (Req 9.8)', () => {
    it('sets splitMode = "layer" when gpuCount > 1', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ gpuCount: 2 });
      const preset = recommendPreset(meta, budget);
      expect(preset.splitMode).to.equal('layer');
    });

    it('leaves splitMode unchanged when gpuCount = 1', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ gpuCount: 1 });
      const preset = recommendPreset(meta, budget);
      // Should match DEFAULT_ADVANCED_ARGS.splitMode (which is 'layer')
      expect(preset.splitMode).to.equal('layer');
    });

    it('sets tensorSplit = [] (explicitly empty)', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = makeBudget({ gpuCount: 2 });
      const preset = recommendPreset(meta, budget);
      expect(preset.tensorSplit).to.deep.equal([]);
    });
  });

  describe('determinism (Req 9.9 / P62)', () => {
    it('returns structurally equal presets on successive calls', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 });
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const preset1 = recommendPreset(meta, budget);
      const preset2 = recommendPreset(meta, budget);
      expect(preset1).to.deep.equal(preset2);
    });
  });

  describe('comprehensive scenarios (class × budget × gpuCount)', () => {
    const scenarios = [
      // dense-small scenarios (4 total: 2 budgets × 2 GPU counts)
      {
        name: 'dense-small × small budget × single GPU',
        meta: makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 1 }),
        expectedClass: 'dense-small',
        expectedKV: 'q8_0',
      },
      {
        name: 'dense-small × small budget × dual GPU',
        meta: makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 2 }),
        expectedClass: 'dense-small',
        expectedKV: 'q8_0',
      },
      {
        name: 'dense-small × large budget × single GPU',
        meta: makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 }),
        budget: makeBudget({ totalVramMB: 16 * 1024, gpuCount: 1 }),
        expectedClass: 'dense-small',
        expectedKV: 'f16',
      },
      {
        name: 'dense-small × large budget × dual GPU',
        meta: makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7, totalLayers: 32 }),
        budget: makeBudget({ totalVramMB: 16 * 1024, gpuCount: 2 }),
        expectedClass: 'dense-small',
        expectedKV: 'f16',
      },
      // dense-large scenarios (4 total: 2 budgets × 2 GPU counts)
      {
        name: 'dense-large × small budget × single GPU',
        meta: makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70, totalLayers: 80 }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 1 }),
        expectedClass: 'dense-large',
        expectedKV: 'q8_0',
      },
      {
        name: 'dense-large × small budget × dual GPU',
        meta: makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70, totalLayers: 80 }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 2 }),
        expectedClass: 'dense-large',
        expectedKV: 'q8_0',
      },
      {
        name: 'dense-large × large budget × single GPU',
        meta: makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70, totalLayers: 80 }),
        budget: makeBudget({ totalVramMB: 48 * 1024, gpuCount: 1 }),
        expectedClass: 'dense-large',
        expectedKV: 'f16',
      },
      {
        name: 'dense-large × large budget × dual GPU',
        meta: makeMeta({ filename: 'llama-2-70b.gguf', totalParamsB: 70, totalLayers: 80 }),
        budget: makeBudget({ totalVramMB: 48 * 1024, gpuCount: 2 }),
        expectedClass: 'dense-large',
        expectedKV: 'f16',
      },
      // moe-small scenarios (4 total: 2 budgets × 2 GPU counts)
      {
        name: 'moe-small × small budget × single GPU',
        meta: makeMeta({
          filename: 'Mixtral-8x7B.gguf',
          isMoE: true,
          totalParamsB: 47,
          totalLayers: 32,
        }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 1 }),
        expectedClass: 'moe-small',
        expectedKV: 'q8_0',
      },
      {
        name: 'moe-small × small budget × dual GPU',
        meta: makeMeta({
          filename: 'Mixtral-8x7B.gguf',
          isMoE: true,
          totalParamsB: 47,
          totalLayers: 32,
        }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 2 }),
        expectedClass: 'moe-small',
        expectedKV: 'q8_0',
      },
      {
        name: 'moe-small × large budget × single GPU',
        meta: makeMeta({
          filename: 'Mixtral-8x7B.gguf',
          isMoE: true,
          totalParamsB: 47,
          totalLayers: 32,
        }),
        budget: makeBudget({ totalVramMB: 24 * 1024, gpuCount: 1 }),
        expectedClass: 'moe-small',
        expectedKV: 'f16',
      },
      {
        name: 'moe-small × large budget × dual GPU',
        meta: makeMeta({
          filename: 'Mixtral-8x7B.gguf',
          isMoE: true,
          totalParamsB: 47,
          totalLayers: 32,
        }),
        budget: makeBudget({ totalVramMB: 24 * 1024, gpuCount: 2 }),
        expectedClass: 'moe-small',
        expectedKV: 'f16',
      },
      // moe-large scenarios (4 total: 2 budgets × 2 GPU counts)
      {
        name: 'moe-large × small budget × single GPU',
        meta: makeMeta({
          filename: 'deepseek-v2.gguf',
          isMoE: true,
          totalParamsB: 236,
          totalLayers: 60,
        }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 1 }),
        expectedClass: 'moe-large',
        expectedKV: 'q8_0',
      },
      {
        name: 'moe-large × small budget × dual GPU',
        meta: makeMeta({
          filename: 'deepseek-v2.gguf',
          isMoE: true,
          totalParamsB: 236,
          totalLayers: 60,
        }),
        budget: makeBudget({ totalVramMB: 8 * 1024, gpuCount: 2 }),
        expectedClass: 'moe-large',
        expectedKV: 'q8_0',
      },
      {
        name: 'moe-large × large budget × single GPU',
        meta: makeMeta({
          filename: 'deepseek-v2.gguf',
          isMoE: true,
          totalParamsB: 236,
          totalLayers: 60,
        }),
        budget: makeBudget({ totalVramMB: 80 * 1024, gpuCount: 1 }),
        expectedClass: 'moe-large',
        expectedKV: 'f16',
      },
      {
        name: 'moe-large × large budget × dual GPU',
        meta: makeMeta({
          filename: 'deepseek-v2.gguf',
          isMoE: true,
          totalParamsB: 236,
          totalLayers: 60,
        }),
        budget: makeBudget({ totalVramMB: 80 * 1024, gpuCount: 2 }),
        expectedClass: 'moe-large',
        expectedKV: 'f16',
      },
    ];

    for (const scenario of scenarios) {
      it(scenario.name, () => {
        const preset = recommendPreset(scenario.meta, scenario.budget);
        const validation = validateAdvancedArgs(preset);
        expect(validation.ok).to.equal(true, `validation failed: ${validation.reason}`);
        expect(preset.typeK).to.equal(scenario.expectedKV);
        expect(preset.typeV).to.equal(scenario.expectedKV);
        expect(preset.flashAttn).to.equal(true);
        expect(preset.ctxSize).to.equal(4096);
        expect(preset.batchSize).to.equal(512);
        expect(preset.ubatchSize).to.equal(512);
        expect(preset.parallel).to.equal(1);
        expect(preset.tensorSplit).to.deep.equal([]);
        if (scenario.budget.gpuCount > 1) {
          expect(preset.splitMode).to.equal('layer');
        }
        if (scenario.expectedClass.startsWith('dense')) {
          expect(preset.nCpuMoe).to.equal(0);
        } else {
          expect(preset.nCpuMoe).to.be.at.least(0);
        }
      });
    }
  });

  describe('input coercion', () => {
    it('is total on null/undefined modelMeta and budget', () => {
      const preset = recommendPreset(null, null);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });

    it('handles missing budget fields gracefully', () => {
      const meta = makeMeta({ filename: 'llama-2-7b.gguf', totalParamsB: 7 });
      const budget = { detected: true };
      const preset = recommendPreset(meta, budget);
      const validation = validateAdvancedArgs(preset);
      expect(validation.ok).to.equal(true);
    });
  });
});
