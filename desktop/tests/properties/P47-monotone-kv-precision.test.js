/**
 * Property Test P47: Monotonicity in KV precision
 *
 * Feature: llama-cpp-memory-tuning, Property 47: Monotonicity in KV precision
 *
 * For any pair of `EstimateInput` values `a`, `b` that are equal except for
 * `a.typeK` and `b.typeK` with
 *   kvPrecisionBytes(a.typeK) <= kvPrecisionBytes(b.typeK)
 * then
 *   estimateRequiredMB(a) <= estimateRequiredMB(b)
 *
 * The analogous property holds for `typeV` (independently of `typeK`): keeping
 * every other field equal, widening V-cache precision never decreases the
 * estimate.
 *
 * Intuition: the refined formula (design §6.1) has only one term that depends
 * on `typeK` / `typeV` — the KV-cache contribution
 *
 *   kvCacheMB = ctxSize * 2 * h * layersOffloaded *
 *               (kvPrecisionBytes(typeK) + kvPrecisionBytes(typeV)) / 4 / BYTES_PER_MIB
 *
 * Every factor on the right is non-negative (ctxSize, h, layersOffloaded all
 * clamp to >= 0), so the total estimate is a non-decreasing function of
 * `kvPrecisionBytes(typeK)` (respectively `typeV`). The MoE subtraction path
 * is independent of KV precision, so the property holds even when `isMoE` is
 * true — which is why the generator is free to mix MoE-on and MoE-off draws.
 *
 * Validates: Requirements 6.8
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { estimateRequiredMB } = require('../../vram-budget-manager');
const { kvPrecisionBytes } = require('../../advanced-args');
const { arbEstimateArgs } = require('../helpers/arb-estimate-args');
const { KV_CACHE_TYPES } = require('../helpers/arb-memory-advanced-args');

/**
 * Arbitrary producing an ordered pair `[lo, hi]` of KV cache types where
 * `kvPrecisionBytes(lo) <= kvPrecisionBytes(hi)`. Duplicates are allowed
 * (the monotonicity statement is `<=`, not `<`), which also exercises the
 * reflexive equality case.
 */
const arbOrderedKvPair = fc
  .tuple(fc.constantFrom(...KV_CACHE_TYPES), fc.constantFrom(...KV_CACHE_TYPES))
  .map(([t1, t2]) => {
    const [lo, hi] =
      kvPrecisionBytes(t1) <= kvPrecisionBytes(t2) ? [t1, t2] : [t2, t1];
    return { lo, hi };
  });

describe('P47: Monotonicity in KV precision', () => {
  it('widening typeK never decreases estimateRequiredMB (all other fields equal)', () => {
    fc.assert(
      fc.property(arbEstimateArgs(), arbOrderedKvPair, (baseArgs, { lo, hi }) => {
        // Only typeK differs between the two inputs; typeV and every other
        // field are inherited verbatim from the same base draw.
        const argsLo = { ...baseArgs, typeK: lo };
        const argsHi = { ...baseArgs, typeK: hi };

        const mbLo = estimateRequiredMB(argsLo);
        const mbHi = estimateRequiredMB(argsHi);

        expect(mbLo).to.be.a('number');
        expect(mbHi).to.be.a('number');
        expect(Number.isFinite(mbLo)).to.equal(true);
        expect(Number.isFinite(mbHi)).to.equal(true);

        // Core monotonicity assertion — exact `<=`, no floating-point slack
        // is needed because every additional term on the `hi` side is the
        // result of multiplying non-negative factors by a strictly larger
        // (or equal) `kvPrecisionFactor`.
        expect(mbHi).to.be.at.least(mbLo);
      }),
      { numRuns: 200 },
    );
  });

  it('widening typeV never decreases estimateRequiredMB (all other fields equal)', () => {
    fc.assert(
      fc.property(arbEstimateArgs(), arbOrderedKvPair, (baseArgs, { lo, hi }) => {
        const argsLo = { ...baseArgs, typeV: lo };
        const argsHi = { ...baseArgs, typeV: hi };

        const mbLo = estimateRequiredMB(argsLo);
        const mbHi = estimateRequiredMB(argsHi);

        expect(Number.isFinite(mbLo)).to.equal(true);
        expect(Number.isFinite(mbHi)).to.equal(true);
        expect(mbHi).to.be.at.least(mbLo);
      }),
      { numRuns: 200 },
    );
  });

  it('widening both typeK and typeV simultaneously never decreases estimateRequiredMB', () => {
    // Combined monotonicity: if both KV precisions rise (or one rises and
    // the other stays equal) the estimate cannot drop. This catches any
    // accidental sign flip or cross-term regression that a per-axis property
    // alone would miss.
    fc.assert(
      fc.property(
        arbEstimateArgs(),
        arbOrderedKvPair,
        arbOrderedKvPair,
        (baseArgs, pairK, pairV) => {
          const argsLo = { ...baseArgs, typeK: pairK.lo, typeV: pairV.lo };
          const argsHi = { ...baseArgs, typeK: pairK.hi, typeV: pairV.hi };

          const mbLo = estimateRequiredMB(argsLo);
          const mbHi = estimateRequiredMB(argsHi);

          expect(Number.isFinite(mbLo)).to.equal(true);
          expect(Number.isFinite(mbHi)).to.equal(true);
          expect(mbHi).to.be.at.least(mbLo);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Reflexivity anchor: when the KV pair is identical, the two estimates are
  // bit-for-bit equal (pure-function determinism + no precision-dependent
  // branch outside the kvCacheMB term). This is a strict subset of the
  // monotonicity property but worth pinning down as a regression test.
  // -------------------------------------------------------------------------
  it('is reflexive: equal typeK and typeV yield equal estimates', () => {
    fc.assert(
      fc.property(
        arbEstimateArgs(),
        fc.constantFrom(...KV_CACHE_TYPES),
        fc.constantFrom(...KV_CACHE_TYPES),
        (baseArgs, tK, tV) => {
          const a = { ...baseArgs, typeK: tK, typeV: tV };
          const b = { ...baseArgs, typeK: tK, typeV: tV };
          expect(estimateRequiredMB(a)).to.equal(estimateRequiredMB(b));
        },
      ),
      { numRuns: 100 },
    );
  });
});
