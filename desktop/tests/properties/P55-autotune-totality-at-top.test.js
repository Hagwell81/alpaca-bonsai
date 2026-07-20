/* eslint-env node, mocha */
/**
 * Property Test P55: `autoTuneNgl` totality at top
 *
 * For any inputs for which `canFit({ ...args, nGpuLayers: totalLayers }, ...)`
 * returns `{ ok: true }`, `autoTuneNgl(...)` returns `totalLayers`.
 *
 * Validates: Requirements 7.4
 *
 * Strategy:
 *   - Draw arbitrary inputs from the full input domain.
 *   - Check if `canFit` returns `{ ok: true }` for `nGpuLayers = totalLayers`.
 *   - When it does, verify that `autoTuneNgl` returns `totalLayers`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl, buildEstimateInput } = require('../../ngl-optimizer.js');
const { canFit } = require('../../vram-budget-manager.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P55: autoTuneNgl totality at top (Req 7.4)', () => {
  it('returns totalLayers when canFit returns ok:true for totalLayers', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0 && m.totalLayers > 0),
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(b.totalVramMB, 16 * 1024) })),
      totalLayers: fc.integer({ min: 1, max: 50 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 2048 }), { maxLength: 2 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        // Check if canFit returns ok:true for nGpuLayers = totalLayers
        const cfgFull = buildEstimateInput(modelMeta, baseArgs, totalLayers);
        const ctx = {
          detected: true,
          totalMB: budget.totalVramMB,
          reservedMB: budget.reservedMB || 0,
          activeAllocationsMB,
        };
        const fitResult = canFit(cfgFull, ctx);

        if (fitResult.ok === true) {
          // When canFit returns ok:true for totalLayers, autoTuneNgl must return totalLayers
          const N = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
          expect(N).to.equal(totalLayers, `autoTuneNgl should return totalLayers when canFit(totalLayers) is ok:true`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when budget is very large and model fits', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0 && m.totalLayers > 0),
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const hugeBudget = {
          detected: true,
          totalVramMB: 256 * 1024, // 256 GiB
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

        const N = autoTuneNgl(modelMeta, baseArgs, hugeBudget, totalLayers, []);

        // If totalLayers fits, autoTuneNgl should return totalLayers
        if (fitResult.ok === true) {
          expect(N).to.equal(totalLayers, `autoTuneNgl should return totalLayers when canFit(totalLayers) is ok:true`);
        }
        // Otherwise, N should be less than totalLayers
        else {
          expect(N).to.be.lessThan(totalLayers);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns totalLayers when model is very small', () => {
    const arbInputs = fc.record({
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(b.totalVramMB, 8 * 1024) })),
      totalLayers: fc.integer({ min: 1, max: 50 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ baseArgs, budget, totalLayers }) => {
        const tinyModel = {
          filename: 'tiny-model.gguf',
          sizeBytes: 100 * 1024 * 1024, // 100 MiB
          totalLayers,
        };

        const N = autoTuneNgl(tinyModel, baseArgs, budget, totalLayers, []);

        // A tiny model should fit entirely
        expect(N).to.equal(totalLayers);
      }),
      { numRuns: 100 },
    );
  });
});
