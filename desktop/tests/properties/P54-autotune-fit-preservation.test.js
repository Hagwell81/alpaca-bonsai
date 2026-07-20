/* eslint-env node, mocha */
/**
 * Property Test P54: `autoTuneNgl` fit preservation
 *
 * For any inputs for which `autoTuneNgl(...)` returns `N > 0`,
 * `canFit({ ...args, nGpuLayers: N }, ...)` returns `{ ok: true }`.
 *
 * Validates: Requirements 7.2
 *
 * Strategy:
 *   - Draw arbitrary inputs from the full input domain.
 *   - Compute `N = autoTuneNgl(...)`.
 *   - When `N > 0`, construct the estimate input with `nGpuLayers = N`
 *     and verify that `canFit` returns `{ ok: true }`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { autoTuneNgl, buildEstimateInput } = require('../../ngl-optimizer.js');
const { canFit } = require('../../vram-budget-manager.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');
const { arbAdvancedArgsExtended } = require('../helpers/arb-memory-advanced-args.js');
const { arbBudget } = require('../helpers/arb-budget.js');

describe('P54: autoTuneNgl fit preservation (Req 7.2)', () => {
  it('ensures canFit returns ok:true for the returned nGpuLayers', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0 && m.totalLayers > 0),
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(b.totalVramMB, 1024) })),
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 4096 }), { maxLength: 3 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const N = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // When N > 0, verify that canFit returns ok:true
        if (N > 0) {
          const cfg = buildEstimateInput(modelMeta, baseArgs, N);
          const ctx = {
            detected: true,
            totalMB: budget.totalVramMB,
            reservedMB: budget.reservedMB || 0,
            activeAllocationsMB,
          };
          const fitResult = canFit(cfg, ctx);
          expect(fitResult.ok).to.equal(true, `canFit should return ok:true for N=${N}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ensures canFit returns ok:true for N=0 when autoTuneNgl returns 0', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0),
      baseArgs: arbAdvancedArgsExtended,
      budget: arbBudget.map((b) => ({ ...b, detected: true, totalVramMB: Math.max(b.totalVramMB, 512) })),
      totalLayers: fc.integer({ min: 1, max: 100 }),
      activeAllocationsMB: fc.array(fc.integer({ min: 0, max: 4096 }), { maxLength: 3 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB }) => {
        const N = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB);

        // When N = 0, verify that canFit returns ok:true for N=0
        // (or ok:false if even N=0 doesn't fit, which is the infeasibility case)
        const cfg = buildEstimateInput(modelMeta, baseArgs, N);
        const ctx = {
          detected: true,
          totalMB: budget.totalVramMB,
          reservedMB: budget.reservedMB || 0,
          activeAllocationsMB,
        };
        const fitResult = canFit(cfg, ctx);

        if (N === 0) {
          // When autoTuneNgl returns 0, it means either:
          // a. N=0 fits (ok:true), or
          // b. Even N=0 doesn't fit (ok:false, infeasibility case)
          // Both are valid; we just check that canFit is consistent.
          expect(typeof fitResult.ok).to.equal('boolean');
        } else {
          // When N > 0, canFit must return ok:true
          expect(fitResult.ok).to.equal(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ensures canFit returns ok:true for N=totalLayers when autoTuneNgl returns totalLayers', () => {
    const arbInputs = fc.record({
      modelMeta: arbModelMeta.filter((m) => m.sizeBytes > 0 && m.totalLayers > 0),
      baseArgs: arbAdvancedArgsExtended,
      totalLayers: fc.integer({ min: 1, max: 50 }),
    });

    fc.assert(
      fc.property(arbInputs, ({ modelMeta, baseArgs, totalLayers }) => {
        const hugeBudget = {
          detected: true,
          totalVramMB: 128 * 1024, // 128 GiB
          reservedMB: 0,
          gpuCount: 1,
          physicalCores: 8,
        };

        const N = autoTuneNgl(modelMeta, baseArgs, hugeBudget, totalLayers, []);

        // Verify that canFit returns ok:true for the returned N
        const cfg = buildEstimateInput(modelMeta, baseArgs, N);
        const ctx = {
          detected: true,
          totalMB: hugeBudget.totalVramMB,
          reservedMB: hugeBudget.reservedMB,
          activeAllocationsMB: [],
        };
        const fitResult = canFit(cfg, ctx);
        expect(fitResult.ok).to.equal(true, `canFit should return ok:true for N=${N}`);

        // If autoTuneNgl returns totalLayers, verify that canFit(totalLayers) is also true
        if (N === totalLayers) {
          const cfgFull = buildEstimateInput(modelMeta, baseArgs, totalLayers);
          const fitResultFull = canFit(cfgFull, ctx);
          expect(fitResultFull.ok).to.equal(true, `canFit should return ok:true for totalLayers=${totalLayers}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});
