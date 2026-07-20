/**
 * Property 48: MoE subtraction anti-monotonicity
 *
 * For any `args` with `isMoE === true` and all fields equal except `nCpuMoe`,
 * if `args1.nCpuMoe <= args2.nCpuMoe` then
 *   `estimateRequiredMB(args1) >= estimateRequiredMB(args2)`.
 *
 * Intuition: pushing more MoE layers onto the CPU (a larger `nCpuMoe`)
 * subtracts more "inactive-expert" weight from the VRAM estimate, so the
 * estimator must be non-increasing in `nCpuMoe` whenever `isMoE === true`.
 * Both `nCpuMoe` values are constrained to `[0, totalLayers]` per design §8's
 * phrasing; this is also the band over which the fraction-clamp
 * `nCpuMoe / totalLayers` is meaningful.
 *
 * Uses `arbEstimateArgsMoe` to guarantee `isMoE: true` draws (with both
 * `activeParamsB` and `totalParamsB` populated) so every run actually
 * exercises the MoE-subtraction branch of the formula. The two runs vary
 * ONLY `nCpuMoe`; every other field is held identical.
 *
 * Validates: Requirements 6.5
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { estimateRequiredMB } = require('../../vram-budget-manager');
const { arbEstimateArgsMoe } = require('../helpers/arb-estimate-args');

describe('P48: MoE subtraction anti-monotonicity', () => {
  // -------------------------------------------------------------------------
  // Core property: non-increasing in `nCpuMoe` when isMoE === true.
  //
  // The two `nCpuMoe` values are drawn independently, ordered, and then both
  // substituted into the same `args` record. Both values live in
  // `[0, totalLayers]` per design §8.
  //
  // 200 runs (design §8 Testing Strategy bump for P45–P48).
  // -------------------------------------------------------------------------

  it('estimateRequiredMB is non-increasing in nCpuMoe for MoE args', () => {
    fc.assert(
      fc.property(
        arbEstimateArgsMoe(),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 999 }),
        (baseArgs, a, b) => {
          // Bound both nCpuMoe draws to `[0, totalLayers]` before ordering,
          // then derive `n1 <= n2` so the implication's antecedent is
          // automatically satisfied without rejecting runs.
          const totalLayers = baseArgs.totalLayers;
          const ca = Math.min(totalLayers, Math.max(0, a));
          const cb = Math.min(totalLayers, Math.max(0, b));
          const n1 = Math.min(ca, cb);
          const n2 = Math.max(ca, cb);

          const args1 = { ...baseArgs, nCpuMoe: n1 };
          const args2 = { ...baseArgs, nCpuMoe: n2 };

          const m1 = estimateRequiredMB(args1);
          const m2 = estimateRequiredMB(args2);

          // Req 6.5: larger nCpuMoe => smaller-or-equal estimate.
          expect(m1).to.be.at.least(
            m2,
            `expected estimate with nCpuMoe=${n1} (${m1}) to be >= ` +
              `estimate with nCpuMoe=${n2} (${m2}); totalLayers=${totalLayers}, ` +
              `activeParamsB=${baseArgs.activeParamsB}, totalParamsB=${baseArgs.totalParamsB}, ` +
              `modelFileSizeMB=${baseArgs.modelFileSizeMB}`,
          );

          // Both results must be finite non-negative numbers (design §6.1 post-condition).
          expect(m1).to.be.a('number').and.not.NaN;
          expect(m2).to.be.a('number').and.not.NaN;
          expect(m1).to.be.at.least(0);
          expect(m2).to.be.at.least(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Endpoint sanity checks — tie the property down to the design §6.1 math.
  //
  // These are deterministic examples rather than property runs; they catch
  // regressions that the random walk might miss on "quiet" draws (e.g.
  // draws whose `nCpuMoe` upper bound still leaves the fraction tiny).
  // -------------------------------------------------------------------------

  it('nCpuMoe = 0 yields an estimate no smaller than any nCpuMoe > 0', () => {
    fc.assert(
      fc.property(
        arbEstimateArgsMoe(),
        fc.integer({ min: 1, max: 999 }),
        (baseArgs, nRaw) => {
          const n = Math.min(baseArgs.totalLayers, Math.max(1, nRaw));
          const atZero = estimateRequiredMB({ ...baseArgs, nCpuMoe: 0 });
          const atN = estimateRequiredMB({ ...baseArgs, nCpuMoe: n });
          expect(atZero).to.be.at.least(atN);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('nCpuMoe = totalLayers yields an estimate no larger than any nCpuMoe < totalLayers', () => {
    fc.assert(
      fc.property(
        arbEstimateArgsMoe(),
        fc.integer({ min: 0, max: 999 }),
        (baseArgs, nRaw) => {
          const totalLayers = baseArgs.totalLayers;
          // Skip the degenerate totalLayers===0 draw; the arbitrary already
          // guarantees totalLayers >= 1 but this makes the intent explicit.
          if (totalLayers <= 0) return;
          const n = Math.min(totalLayers - 0, Math.max(0, nRaw));
          const atTop = estimateRequiredMB({ ...baseArgs, nCpuMoe: totalLayers });
          const atN = estimateRequiredMB({ ...baseArgs, nCpuMoe: n });
          expect(atN).to.be.at.least(atTop);
        },
      ),
      { numRuns: 200 },
    );
  });
});
