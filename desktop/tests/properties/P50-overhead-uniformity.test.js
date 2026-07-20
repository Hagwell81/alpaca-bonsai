/* eslint-env node, mocha */
/**
 * Property Test P50: Per-instance overhead uniformity
 *
 * Feature: llama-cpp-memory-tuning, Property 50 (design §8)
 *
 * For every valid `EstimateArgs` input `a`,
 *
 *     estimateRequiredMB(a) - oracleEstimateKvAndWeightAndMmprojMB(a)
 *       === PER_INSTANCE_OVERHEAD_MB                    // exactly 256
 *
 * within a tiny floating-point epsilon. The oracle (an independent reference
 * of the design-§6.1 formula located at `tests/helpers/oracle-estimate.js`)
 * computes the `kv + weight + mmproj` portion of the estimate, so whatever
 * remains after subtracting the oracle from the production estimator must be
 * the single `PER_INSTANCE_OVERHEAD_MB` term added by the production path
 * (design §6.1, Req 6.6). The corollary — stated in design §8 — is that
 * the difference is *uniform* across calls: for any two inputs `a, b`,
 *
 *     (estimateRequiredMB(a) - kvAndWeightAndMmproj(a))
 *   - (estimateRequiredMB(b) - kvAndWeightAndMmproj(b))
 *       === 0
 *
 * i.e. the overhead is added exactly once and identically on every call.
 * Both phrasings are asserted below so a regression in either direction —
 * wrong constant, or drift between the two formulas — fails loudly.
 *
 * A tight absolute epsilon (`1e-6` MiB) is used because both expressions are
 * sums of the same sub-terms in the same evaluation order; the only
 * numerically distinct operation between production and oracle is the extra
 * `+ 256` at the end of the production path, and under IEEE-754 doubles that
 * addition is exact for every magnitude realistically produced by the
 * generator (weight/KV/mmproj totals stay well under 2^48 MiB).
 *
 * Validates: Requirements 6.6
 *
 * Strategy:
 *   - Draw args from `arbEstimateArgs` (which spans MoE-on / MoE-off, every
 *     `nGpuLayers` sentinel including `-1`, the full seven-value KV type
 *     spread for both `typeK` and `typeV`, and both the default and
 *     overridden mmproj / hidden-size branches).
 *   - Default fast-check runs (100) per tasks.md Task 5.7.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  estimateRequiredMB,
  PER_INSTANCE_OVERHEAD_MB,
} = require('../../vram-budget-manager');
const {
  oracleEstimateKvAndWeightAndMmprojMB,
} = require('../helpers/oracle-estimate');
const { arbEstimateArgs } = require('../helpers/arb-estimate-args');

// ---------------------------------------------------------------------------
// Numeric tolerance
// ---------------------------------------------------------------------------
//
// Production and oracle share the identical arithmetic for weight, KV, MoE
// subtraction, and mmproj, so the only rounding that can separate them comes
// from the production's final `+ PER_INSTANCE_OVERHEAD_MB`. For estimator
// totals in the MiB range this step is bit-exact in IEEE-754; a 1e-6 MiB
// envelope is three orders of magnitude larger than any possible rounding
// slack and still tight enough to catch a real regression.
const EPSILON_MB = 1e-6;

describe('P50: per-instance overhead uniformity', () => {
  // -------------------------------------------------------------------------
  // Sanity regression anchor: the exported constant is the documented 256.
  // -------------------------------------------------------------------------
  it('exports PER_INSTANCE_OVERHEAD_MB === 256', () => {
    expect(PER_INSTANCE_OVERHEAD_MB).to.equal(256);
  });

  // -------------------------------------------------------------------------
  // Main property: the difference between production and oracle is always
  // exactly PER_INSTANCE_OVERHEAD_MB (within EPSILON_MB).
  // -------------------------------------------------------------------------
  it('estimateRequiredMB(args) - oracle(args) === PER_INSTANCE_OVERHEAD_MB for every valid args', () => {
    fc.assert(
      fc.property(arbEstimateArgs(), (args) => {
        const prod = estimateRequiredMB(args);
        const oracle = oracleEstimateKvAndWeightAndMmprojMB(args);
        const diff = prod - oracle;
        expect(Number.isFinite(prod)).to.equal(
          true,
          `estimateRequiredMB returned non-finite ${prod}`,
        );
        expect(Number.isFinite(oracle)).to.equal(
          true,
          `oracle returned non-finite ${oracle}`,
        );
        expect(Math.abs(diff - PER_INSTANCE_OVERHEAD_MB)).to.be.at.most(
          EPSILON_MB,
          `args=${JSON.stringify(args)} produced diff=${diff}`,
        );
      }),
      // Default fast-check runs (100) per tasks.md.
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Uniformity restatement: the overhead delta does not depend on the input.
  // This is the exact quantifier used in design §8.
  // -------------------------------------------------------------------------
  it('(prod(a) - oracle(a)) - (prod(b) - oracle(b)) === 0 for every pair a, b', () => {
    fc.assert(
      fc.property(arbEstimateArgs(), arbEstimateArgs(), (a, b) => {
        const deltaA = estimateRequiredMB(a) - oracleEstimateKvAndWeightAndMmprojMB(a);
        const deltaB = estimateRequiredMB(b) - oracleEstimateKvAndWeightAndMmprojMB(b);
        expect(Math.abs(deltaA - deltaB)).to.be.at.most(
          EPSILON_MB,
          `deltaA=${deltaA}, deltaB=${deltaB}, a=${JSON.stringify(a)}, b=${JSON.stringify(b)}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
