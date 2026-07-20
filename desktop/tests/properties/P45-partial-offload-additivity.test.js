/* eslint-env node, mocha */
/**
 * Property Test P45: Partial-offload additivity
 *
 * Feature: llama-cpp-memory-tuning, Property 45: Partial-offload additivity
 *
 * For any fixed `EstimateInput` args with `isMoE === false`,
 * `modelFileSizeMB > 0`, and `totalLayers > 0`, and for any integer pair
 * `(n1, n2)` with `0 <= n1 <= n2 <= totalLayers`, the value
 *
 *     w(x) = estimateRequiredMB({...args, nGpuLayers: x})
 *          - estimateRequiredMB({...args, nGpuLayers: 0})
 *
 * is linear in `x`. The delta between two offload points therefore reduces
 * to the algebraic sum of the two linear contributions the estimator adds
 * when `isMoE === false`:
 *
 *   w(n2) - w(n1) ==   modelFileSizeMB * (n2 - n1) / totalLayers           // model-weight
 *                    + ctxSize * 2 * h * (n2 - n1) * kvPrecisionFactor
 *                      / (1024 * 1024)                                     // KV cache
 *
 * where `h` defaults to `DEFAULT_HBYTES_PER_TOKEN_PER_LAYER = 256` and
 * `kvPrecisionFactor = (kvPrecisionBytes(typeK) + kvPrecisionBytes(typeV))
 * / 4` (so `f16/f16` collapses to `1.0`). The `mmproj`, per-instance
 * overhead, and MoE-subtraction terms all cancel across `estimate(n1)` and
 * `estimate(n2)` when the other fields are held fixed and `isMoE === false`.
 *
 * The property therefore asserts three things on every draw:
 *   1. Additivity / linearity: `w(n2) - w(n1)` equals the expected
 *      closed-form delta above, up to IEEE-754 rounding slack.
 *   2. Monotonicity: `w(n2) - w(n1) >= 0` (a direct corollary of linearity
 *      with both sub-term slopes non-negative).
 *   3. Strict positivity: when `n2 > n1`, the increment is strictly
 *      positive. This follows because `modelFileSizeMB > 0` and
 *      `totalLayers > 0` guarantee the model-weight slope is strictly
 *      positive; the KV term is also non-negative so cannot cancel it out.
 *
 * Task-specified run count: **200** (design §8.6 Testing Strategy).
 *
 * Validates: Requirements 6.1
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { estimateRequiredMB } = require('../../vram-budget-manager');
const { kvPrecisionBytes } = require('../../advanced-args');
const { arbEstimateArgs } = require('../helpers/arb-estimate-args');

// ---------------------------------------------------------------------------
// Formula constants reproduced from design §6.1 / vram-budget-manager.js.
//
// Kept local to the test so a silent change to either the production
// constant or the design document surfaces as a property-test failure
// rather than as a silently-coincident drift.
// ---------------------------------------------------------------------------

/** Bytes per MiB — used to convert KV cache bytes into MiB. */
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Default bytes-per-token-per-layer used when `args.hiddenSizeBytesPerTokenPerLayer`
 * is missing. Matches the production default in `estimateRequiredMB`.
 */
const DEFAULT_HBYTES_PER_TOKEN_PER_LAYER = 256;

// ---------------------------------------------------------------------------
// Test generator
// ---------------------------------------------------------------------------

/**
 * Draw a base `EstimateInput` with `isMoE === false`, `modelFileSizeMB > 0`,
 * and `totalLayers > 0` (both required by the property's hypothesis), then
 * pick an ordered pair `(n1, n2)` in `[0, totalLayers]`.
 *
 * The MoE-only fields (`activeParamsB`, `totalParamsB`) are stripped
 * defensively: when `isMoE === false` the estimator ignores them, but
 * leaving them on the draw would let an accidental future regression that
 * reads MoE fields for dense models slip through undetected.
 */
const arbDenseArgsAndPair = arbEstimateArgs()
  .map((a) => {
    // Force the dense branch and strip MoE-only fields so the hypothesis
    // is trivially satisfied regardless of what the underlying arbitrary
    // drew for `isMoE`.
    const { activeParamsB: _a, totalParamsB: _t, ...rest } = a;
    return { ...rest, isMoE: false };
  })
  .filter((a) => a.modelFileSizeMB > 0 && a.totalLayers > 0)
  .chain((args) =>
    fc
      .tuple(
        fc.integer({ min: 0, max: args.totalLayers }),
        fc.integer({ min: 0, max: args.totalLayers }),
      )
      .map(([a, b]) => ({
        args,
        n1: Math.min(a, b),
        n2: Math.max(a, b),
      })),
  );

// ---------------------------------------------------------------------------
// Oracle — expected linear delta (closed form)
// ---------------------------------------------------------------------------

/**
 * Closed-form expected value of
 *   estimateRequiredMB({...args, nGpuLayers: n2})
 * - estimateRequiredMB({...args, nGpuLayers: n1})
 * for a dense (`isMoE === false`) input, derived directly from design §6.1.
 *
 * Ignores the per-instance overhead (256), the mmproj default, and any MoE
 * subtraction — all three cancel out when differencing two estimates that
 * share every field except `nGpuLayers`.
 *
 * @param {object} args
 * @param {number} n1 - lower layer count (0 <= n1 <= n2 <= args.totalLayers)
 * @param {number} n2 - upper layer count
 * @returns {number} expected MiB delta
 */
function expectedDelta(args, n1, n2) {
  const h =
    Number.isFinite(args.hiddenSizeBytesPerTokenPerLayer) &&
    args.hiddenSizeBytesPerTokenPerLayer >= 0
      ? args.hiddenSizeBytesPerTokenPerLayer
      : DEFAULT_HBYTES_PER_TOKEN_PER_LAYER;

  const kvPrecisionFactor =
    (kvPrecisionBytes(args.typeK) + kvPrecisionBytes(args.typeV)) / 4;

  const layerDelta = n2 - n1;

  const weightDelta =
    (args.modelFileSizeMB * layerDelta) / args.totalLayers;

  const kvDeltaBytes = args.ctxSize * 2 * h * layerDelta * kvPrecisionFactor;
  const kvDeltaMB = kvDeltaBytes / BYTES_PER_MIB;

  return weightDelta + kvDeltaMB;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('P45: Partial-offload additivity', () => {
  it('delta between estimate(n1) and estimate(n2) is linear in layersOffloaded for dense models', () => {
    fc.assert(
      fc.property(arbDenseArgsAndPair, ({ args, n1, n2 }) => {
        const e1 = estimateRequiredMB({ ...args, nGpuLayers: n1 });
        const e2 = estimateRequiredMB({ ...args, nGpuLayers: n2 });
        const actualDelta = e2 - e1;
        const expected = expectedDelta(args, n1, n2);

        // --- Linearity ------------------------------------------------------
        // Relative + absolute tolerance: IEEE-754 rounding over the chained
        // multiply/divide in both paths can differ in the low-order bits.
        // The two computations are algebraically equal, so a slack of a few
        // hundred ulps is sufficient.
        const epsilon = Math.max(1e-6, 1e-9 * Math.abs(expected));
        expect(
          Math.abs(actualDelta - expected),
          `expected ${expected} but got delta=${actualDelta} ` +
            `(n1=${n1}, n2=${n2}, file=${args.modelFileSizeMB}, ` +
            `layers=${args.totalLayers}, ctx=${args.ctxSize}, ` +
            `typeK=${args.typeK}, typeV=${args.typeV})`,
        ).to.be.at.most(epsilon);

        // --- Monotonicity ---------------------------------------------------
        // Both slopes are non-negative, so the delta itself is non-negative.
        expect(actualDelta).to.be.at.least(-epsilon);

        // --- Strict positivity when n2 > n1 ---------------------------------
        // modelFileSizeMB > 0 and totalLayers > 0 together guarantee the
        // model-weight slope is strictly positive; the KV term cannot be
        // negative, so the total increment is strictly positive.
        if (n2 > n1) {
          expect(
            actualDelta,
            `expected strict positivity at n1=${n1}, n2=${n2}`,
          ).to.be.greaterThan(0);
        } else {
          // n1 === n2 → delta is exactly 0 (same call, same inputs).
          expect(actualDelta).to.equal(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
