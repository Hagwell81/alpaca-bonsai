/**
 * Property Test P39: `kvPrecisionBytes` total-function behaviour
 *
 * For every legal type in the seven-entry KV_PRECISION_BYTES table,
 * `kvPrecisionBytes` returns a strictly positive finite number. For every
 * value outside that set (arbitrary strings, numbers, `null`, `undefined`,
 * objects, arrays), it throws `UnknownKvCacheTypeError`.
 *
 * Validates: Requirements 2.4
 *
 * Feature: llama-cpp-memory-tuning, Property 39: kvPrecisionBytes total-function behaviour
 */

const { expect } = require('chai');
const fc = require('fast-check');
const {
  KV_PRECISION_BYTES,
  UnknownKvCacheTypeError,
  kvPrecisionBytes,
} = require('../../advanced-args.js');

/**
 * The seven legal KV cache type strings. Frozen separately from the byte-cost
 * table so we never accidentally re-use a mutable reference inside arbitraries.
 */
const LEGAL_KV_TYPES = Object.freeze([
  'f32',
  'f16',
  'q8_0',
  'q5_1',
  'q5_0',
  'q4_1',
  'q4_0',
]);

/**
 * Membership predicate: `true` iff `value` is one of the seven legal strings.
 * Guards the illegal arbitrary so generated strings are never accidentally
 * classified as illegal when they land on a legal value.
 */
function isLegalKvType(value) {
  return typeof value === 'string' && LEGAL_KV_TYPES.indexOf(value) !== -1;
}

/**
 * Arbitrary for legal KV cache type strings.
 */
const legalKvTypeArb = fc.constantFrom(...LEGAL_KV_TYPES);

/**
 * Arbitrary for illegal KV cache type values.
 *
 * Mixes the six disjoint illegal domains described in the property:
 *   - arbitrary strings (excluding the seven legal values)
 *   - arbitrary numbers (including NaN, Infinity, 0, negatives, the byte-cost
 *     numbers themselves, which would collide if coercion leaked through)
 *   - the `null` literal
 *   - the `undefined` literal
 *   - plain objects (including shapes that mimic the table)
 *   - arrays of varying shapes
 *
 * `fc.oneof` distributes the probability across the six shapes so each domain
 * is exercised by every test run.
 */
const illegalKvTypeArb = fc.oneof(
  // Arbitrary strings, excluding the seven legal values.
  fc.string().filter((s) => !isLegalKvType(s)),
  // Numbers: integers, doubles, specials. These must never coerce into the
  // string keys even when the value equals one of the byte-cost outputs.
  fc.oneof(
    fc.integer(),
    fc.double(),
    fc.constantFrom(0, 1, 2, 4, 0.5, 0.625, 0.75, 0.5625, NaN, Infinity, -Infinity),
  ),
  fc.constant(null),
  fc.constant(undefined),
  // Plain objects. `anything` skips functions/classes; a flat record keeps the
  // generator deterministic while still varying shape.
  fc.oneof(
    fc.constant({}),
    fc.record({ f16: fc.integer() }),
    fc.dictionary(fc.string(), fc.integer()),
  ),
  // Arrays.
  fc.oneof(
    fc.constant([]),
    fc.array(fc.string()),
    fc.array(fc.integer()),
    fc.constantFrom(['f16'], [2]),
  ),
);

describe('P39: kvPrecisionBytes total-function behaviour (Req 2.4)', () => {
  it('returns a strictly positive finite number for every legal KV cache type', () => {
    fc.assert(
      fc.property(legalKvTypeArb, (kvType) => {
        const bytes = kvPrecisionBytes(kvType);
        expect(bytes).to.be.a('number');
        expect(Number.isFinite(bytes)).to.equal(true);
        expect(bytes).to.be.greaterThan(0);
        // The function result must match the frozen table exactly - otherwise
        // downstream monotonicity properties (P47) would silently diverge.
        expect(bytes).to.equal(KV_PRECISION_BYTES[kvType]);
      })
    );
  });

  it('throws UnknownKvCacheTypeError for every value outside the seven-entry set', () => {
    fc.assert(
      fc.property(illegalKvTypeArb, (value) => {
        // Double-check that our filter and generator never leak a legal value.
        // fast-check will shrink this to the simplest offender if it fires.
        expect(isLegalKvType(value)).to.equal(false);

        let caught = null;
        try {
          kvPrecisionBytes(value);
        } catch (err) {
          caught = err;
        }

        expect(caught, 'expected kvPrecisionBytes to throw').to.not.equal(null);
        expect(caught).to.be.instanceOf(UnknownKvCacheTypeError);
        expect(caught).to.be.instanceOf(Error);
        expect(caught.name).to.equal('UnknownKvCacheTypeError');
        // The error surfaces the offending value unchanged. Use Object.is so
        // NaN round-trips correctly (NaN !== NaN under strict equality).
        expect(Object.is(caught.value, value)).to.equal(true);
      })
    );
  });

  it('agrees with the membership oracle across a mixed legal/illegal arbitrary', () => {
    // Single property exercising both domains in one shrinkable run. This is
    // the explicit "arbitraries that mix both domains" clause from the task
    // description: every generated value is classified by the oracle and the
    // function's behaviour (return vs throw) must match.
    const mixedArb = fc.oneof(legalKvTypeArb, illegalKvTypeArb);

    fc.assert(
      fc.property(mixedArb, (value) => {
        const legal = isLegalKvType(value);

        if (legal) {
          // Must return; must never throw.
          const bytes = kvPrecisionBytes(value);
          expect(Number.isFinite(bytes)).to.equal(true);
          expect(bytes).to.be.greaterThan(0);
        } else {
          // Must throw UnknownKvCacheTypeError; must never return.
          expect(() => kvPrecisionBytes(value)).to.throw(UnknownKvCacheTypeError);
        }
      })
    );
  });
});
