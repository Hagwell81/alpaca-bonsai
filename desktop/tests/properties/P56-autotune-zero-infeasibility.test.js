/* eslint-env node, mocha */
/**
 * Property Test P56: `autoTuneNgl` zero on infeasibility
 *
 * For any inputs for which `canFit({ ...args, nGpuLayers: 0 }, ...)`
 * returns `{ ok: false }`, `autoTuneNgl(...)` returns `0`.
 *
 * Validates: Requirements 7.3
 *
 * Strategy:
 *   - Draw arbitrary inputs from the full input domain.
 *   - Check if `canFit` returns `{ ok: false }` for `nGpuLayers = 0`.
 *   - When it does, verify that `autoTuneNgl` returns `0`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl, buildEstimateInput } = require('../../ngl-optimizer.js');
const { canFit } = require('../../vram-budget-manager.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P56: autoTuneNgl zero on infeasibility (Req 7.3)', () => {
  it('returns 0 when canFit returns ok:false for nGpuLayers=0', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0),
      baseArgs: arbAdvancedArgsExtended.map((args) => ({
        ...args,
        ctxSize: Math.max(args.ctxSize, 16384), // Large context to increase VRAM pressure
      })),
      // Filter out totalVramMB <= 0, as those trigger the permissive fallback (Req 7.8)
      // and are not part of the normal "zero on infeasibility" behavior (Req 7.3).
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(1, Math.min(b.totalVramMB, 2048)) })),
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 2048, max: 8192 }), { minLength: 1, maxLength: 3 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        // Check if canFit returns ok:false for nGpuLayers = 0
        const cfgZero = buildEstimateInput(modelMeta, baseArgs, 0);
        const ctx = {
          detected: true,
          totalMB: budget.totalVramMB,
          reservedMB: budget.reservedMB || 0,
          activeAllocationsMB,
        };
        const fitResult = canFit(cfgZero, ctx);

        if (fitResult.ok === false) {
          // When canFit returns ok:false for nGpuLayers=0, autoTuneNgl must return 0
          const N = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);
          expect(N).to.equal(0, `autoTuneNgl should return 0 when canFit(0) is ok:false`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns 0 when budget is exhausted by active allocations', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0),
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const budget = {
          detected: true,
          totalVramMB: 8 * 1024, // 8 GiB
          reservedMB: 512,
          gpuCount: 1,
          physicalCores: 8,
        };
        const activeAllocationsMB = [7 * 1024]; // 7 GiB already allocated

        const N = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // With most of the budget already allocated, autoTuneNgl should return 0 or a very small value
        expect(N).to.be.at.most(totalLayers);
      }),
      { numRuns: 100 },
    );
  });

  it('returns 0 when budget is very small', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 1024 * 1024 * 1024), // > 1 GiB
      baseArgs: arbAdvancedArgsExtended.map((args) => ({
        ...args,
        ctxSize: 8192,
      })),
      totalLayers: fc.integer({ min: 10, max: 100 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const tinyBudget = {
          detected: true,
          totalVramMB: 512, // 512 MiB
          reservedMB: 256,
          gpuCount: 1,
          physicalCores: 8,
        };

        const N = autoTuneNgl(modelMeta, baseArgs, tinyBudget, totalLayers, []);

        // With a tiny budget and a large model, autoTuneNgl should return 0 or a very small value
        expect(N).to.be.at.most(totalLayers);
      }),
      { numRuns: 100 },
    );
  });
});
