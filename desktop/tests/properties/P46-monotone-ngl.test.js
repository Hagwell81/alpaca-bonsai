/* eslint-env node, mocha */
/**
 * Property Test P46: Monotonicity in `nGpuLayers`
 *
 * For any `args` with `a.nGpuLayers <= b.nGpuLayers` and all other fields
 * equal, `estimateRequiredMB(a) <= estimateRequiredMB(b)`.
 *
 * Validates: Requirements 6.7
 *
 * Strategy:
 *   - Draw two `EstimateInput` values from `arbEstimateArgs` that differ
 *     only in `nGpuLayers`, with `a.nGpuLayers <= b.nGpuLayers`.
 *   - Compute `estimateRequiredMB(a)` and `estimateRequiredMB(b)`.
 *   - Assert `estimateA <= estimateB`.
 *   - Run 200 iterations per the design's testing strategy (Req 6.7 / P46).
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { estimateRequiredMB } = require('../../vram-budget-manager.js');
const { arbEstimateArgs } = require('../helpers/arb-estimate-args.js');

describe('P46: Monotonicity in nGpuLayers (Req 6.7)', () => {
  it('estimateRequiredMB is non-decreasing in nGpuLayers', () => {
    // Generate pairs of EstimateInput values that differ only in nGpuLayers.
    // The `-1` sentinel means "full offload" (equivalent to totalLayers), so
    // it is NOT numerically comparable with 0..totalLayers — it always binds
    // to the top of the range. Monotonicity is therefore stated over the
    // non-sentinel domain `[0, totalLayers]`, and a separate sub-test below
    // asserts `estimate(-1) === estimate(totalLayers)`.
    const arbMonotonePair = arbEstimateArgs().chain((base) => {
      const maxLayers = base.totalLayers || 999;
      return fc
        .tuple(
          fc.integer({ min: 0, max: maxLayers }),
          fc.integer({ min: 0, max: maxLayers }),
        )
        .filter(([a, b]) => a <= b)
        .map(([nglA, nglB]) => ({
          a: { ...base, nGpuLayers: nglA },
          b: { ...base, nGpuLayers: nglB },
        }));
    });

    fc.assert(
      fc.property(arbMonotonePair, ({ a, b }) => {
        const estimateA = estimateRequiredMB(a);
        const estimateB = estimateRequiredMB(b);

        // Monotonicity: a.nGpuLayers <= b.nGpuLayers → estimateA <= estimateB
        expect(estimateA).to.be.at.most(estimateB);
      }),
      { numRuns: 200 }, // Req 6.7 / P46: 200 runs
    );
  });

  it('estimate increases strictly when offloading more layers (non-zero model)', () => {
    // For models with non-zero size and layers, increasing nGpuLayers
    // should strictly increase the estimate (not just non-decrease).
    const arbNonZeroModel = arbEstimateArgs().filter(
      (args) =>
        args.modelFileSizeMB > 0 &&
        args.totalLayers > 0 &&
        args.nGpuLayers >= 0 &&
        args.nGpuLayers < args.totalLayers,
    );

    fc.assert(
      fc.property(arbNonZeroModel, (base) => {
        const nglLow = base.nGpuLayers;
        const nglHigh = Math.min(nglLow + 1, base.totalLayers);
        const argsLow = { ...base, nGpuLayers: nglLow };
        const argsHigh = { ...base, nGpuLayers: nglHigh };

        const estimateLow = estimateRequiredMB(argsLow);
        const estimateHigh = estimateRequiredMB(argsHigh);

        // Strict increase for non-zero models
        expect(estimateHigh).to.be.greaterThan(estimateLow);
      }),
      { numRuns: 200 },
    );
  });

  it('handles the sentinel -1 (full offload) correctly', () => {
    // When nGpuLayers == -1, the estimator treats it as totalLayers.
    // So estimate(-1) should equal estimate(totalLayers).
    const arbWithSentinel = arbEstimateArgs().filter(
      (args) => args.totalLayers > 0,
    );

    fc.assert(
      fc.property(arbWithSentinel, (base) => {
        const argsSentinel = { ...base, nGpuLayers: -1 };
        const argsFull = { ...base, nGpuLayers: base.totalLayers };

        const estimateSentinel = estimateRequiredMB(argsSentinel);
        const estimateFull = estimateRequiredMB(argsFull);

        expect(estimateSentinel).to.be.closeTo(estimateFull, 0.01);
      }),
      { numRuns: 200 },
    );
  });

  it('estimate at nGpuLayers=0 is minimal (only KV cache + overhead)', () => {
    // When nGpuLayers == 0, the model-weight contribution is zero.
    // The estimate should be strictly less than any positive nGpuLayers.
    const arbNonZeroLayers = arbEstimateArgs().filter(
      (args) => args.totalLayers > 0 && args.modelFileSizeMB > 0,
    );

    fc.assert(
      fc.property(arbNonZeroLayers, (base) => {
        const argsZero = { ...base, nGpuLayers: 0 };
        const argsOne = { ...base, nGpuLayers: 1 };

        const estimateZero = estimateRequiredMB(argsZero);
        const estimateOne = estimateRequiredMB(argsOne);

        expect(estimateZero).to.be.lessThan(estimateOne);
      }),
      { numRuns: 200 },
    );
  });
});
