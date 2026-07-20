/* eslint-env node, mocha */
/**
 * Property Test P49: MoE irrelevance for dense models
 *
 * Feature: llama-cpp-memory-tuning, Property 49: MoE irrelevance for dense
 * models.
 *
 * For any `EstimateInput` `args` with `isMoE === false`, and for any two
 * integers `j, k` in `[0, 999]`,
 *
 *   estimateRequiredMB({ ...args, nCpuMoe: j })
 *     === estimateRequiredMB({ ...args, nCpuMoe: k }).
 *
 * Equivalently: when `isMoE === false`, the value of `nCpuMoe` has no effect
 * on the returned estimate (design §6.1, Req 6.9). The refined formula
 * only consumes `nCpuMoe` inside the `if (args.isMoE && args.nCpuMoe > 0)`
 * guard, so flipping `isMoE` off must short-circuit every branch that could
 * read the field.
 *
 * Validates: Requirements 6.9
 *
 * Strategy:
 *   Draw dense `EstimateInput` values from `arbEstimateArgsDense` (which
 *   forces `isMoE: false` and strips the MoE-only fields) and draw two
 *   independent `nCpuMoe` overrides from the full legal range `[0, 999]`.
 *   Both overrides include the boundary values `0` (flag-absent case) and
 *   `999` (flag-saturated case) via fast-check's shrinking heuristics, so
 *   the default 100-run campaign is sufficient to surface any divergence.
 *
 *   Equality is asserted with strict `===` because the formula is a
 *   deterministic composition of IEEE-754 additions and multiplications
 *   that do not depend on `nCpuMoe` in the dense branch — so any two
 *   results produced by the same code path on the same inputs must be
 *   bit-identical doubles.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { estimateRequiredMB } = require('../../vram-budget-manager');
const { arbEstimateArgsDense } = require('../helpers/arb-estimate-args');

/**
 * Arbitrary for `nCpuMoe` covering the full legal range per Req 3.1.
 *
 * The boundary values `0` and `999` are upweighted so they show up
 * consistently inside the default 100-run campaign.
 */
const arbNCpuMoe = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 2, arbitrary: fc.constant(999) },
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 999 }) },
);

describe('P49: estimateRequiredMB is independent of nCpuMoe for dense models', () => {
  it('isMoE === false ⇒ estimate does not depend on nCpuMoe', () => {
    fc.assert(
      fc.property(
        arbEstimateArgsDense(),
        arbNCpuMoe,
        arbNCpuMoe,
        (args, j, k) => {
          // Precondition sanity check: the dense arbitrary must actually
          // produce `isMoE: false`. If the generator ever drifts, this
          // assertion surfaces the breakage loudly instead of letting the
          // property vacuously "pass".
          expect(args.isMoE).to.equal(false);

          const a = estimateRequiredMB({ ...args, nCpuMoe: j });
          const b = estimateRequiredMB({ ...args, nCpuMoe: k });

          // Both calls use the same dense input and the same code path,
          // so the result must be bit-identical — no epsilon needed.
          expect(a).to.equal(b);
        },
      ),
      // Default fast-check runs (100) per tasks.md.
      { numRuns: 100 },
    );
  });
});
