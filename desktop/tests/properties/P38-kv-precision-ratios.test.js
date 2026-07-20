/**
 * Property Test P38: kvPrecisionBytes ratio table
 *
 * Feature: llama-cpp-memory-tuning, Property 38: kvPrecisionBytes ratio table
 *
 * For the seven allowed KvCacheType values, kvPrecisionBytes satisfies the
 * pointwise table
 *
 *   { f32: 4, f16: 2, q8_0: 1, q5_1: 0.75, q5_0: 0.625, q4_1: 0.5625, q4_0: 0.5 }
 *
 * and every pair-wise ratio kvPrecisionBytes(a) / kvPrecisionBytes(b) equals
 * the exact table ratio. Because every table entry is a power-of-two (or a
 * sum of two powers of two) fraction, the ratios are representable exactly in
 * IEEE-754 double precision — no floating-point slack is required.
 *
 * The three named ratios from design §8 are also asserted explicitly as
 * regression anchors:
 *   - kvPrecisionBytes("q8_0") * 2 === kvPrecisionBytes("f16")
 *   - kvPrecisionBytes("q4_0") * 4 === kvPrecisionBytes("f16")
 *   - kvPrecisionBytes("f32")     === kvPrecisionBytes("f16") * 2
 *
 * Validates: Requirements 2.4
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  kvPrecisionBytes,
  KV_PRECISION_BYTES,
} = require('../../advanced-args');
const { arbKvCacheType } = require('../helpers/arb-memory-advanced-args');

// ---------------------------------------------------------------------------
// Oracle table
// ---------------------------------------------------------------------------

/**
 * Reference table used by the property. Duplicated from the design's
 * Req 2.4 specification (and from `advanced-args.js`' `KV_PRECISION_BYTES`)
 * so the property fails if the production module drifts.
 */
const EXPECTED_BYTES = Object.freeze({
  f32: 4,
  f16: 2,
  q8_0: 1,
  q5_1: 0.75,
  q5_0: 0.625,
  q4_1: 0.5625,
  q4_0: 0.5,
});

const KV_TYPES = Object.freeze(Object.keys(EXPECTED_BYTES));

describe('P38: kvPrecisionBytes ratio table', () => {
  it('pointwise: every KV type maps to its exact table value', () => {
    for (const t of KV_TYPES) {
      expect(kvPrecisionBytes(t)).to.equal(EXPECTED_BYTES[t]);
      // Also cross-check the module's exported constant stays in sync with
      // the oracle table — if these diverge, every downstream property is
      // meaningless.
      expect(KV_PRECISION_BYTES[t]).to.equal(EXPECTED_BYTES[t]);
    }
  });

  it('named design-§8 ratios (q8_0, q4_0, f32 vs f16) hold exactly', () => {
    expect(kvPrecisionBytes('q8_0') * 2).to.equal(kvPrecisionBytes('f16'));
    expect(kvPrecisionBytes('q4_0') * 4).to.equal(kvPrecisionBytes('f16'));
    expect(kvPrecisionBytes('f32')).to.equal(kvPrecisionBytes('f16') * 2);
  });

  it('pair-wise: kvPrecisionBytes(a) / kvPrecisionBytes(b) matches the oracle ratio exactly', () => {
    fc.assert(
      fc.property(arbKvCacheType, arbKvCacheType, (a, b) => {
        const actual = kvPrecisionBytes(a) / kvPrecisionBytes(b);
        const expected = EXPECTED_BYTES[a] / EXPECTED_BYTES[b];
        // Exact equality: every table entry is a dyadic rational with a
        // small enough denominator that the division is representable
        // without rounding in IEEE-754 doubles. No epsilon needed.
        expect(actual).to.equal(expected);
      }),
      // Default fast-check runs (100) per tasks.md.
    );
  });
});
