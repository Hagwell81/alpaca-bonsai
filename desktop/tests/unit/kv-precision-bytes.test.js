/**
 * Unit Tests for kvPrecisionBytes and KV_PRECISION_BYTES (advanced-args.js)
 *
 * Exercises the total-function contract specified in Req 2.4:
 *   - The seven-entry byte-cost table is exact (f32, f16, q8_0, q5_1, q5_0, q4_1, q4_0).
 *   - Any input outside the documented string set raises `UnknownKvCacheTypeError`
 *     (unknown strings, `null`, `undefined`, and numbers).
 *
 * Requirements: 2.4
 */

const { expect } = require('chai');
const {
  KV_PRECISION_BYTES,
  UnknownKvCacheTypeError,
  kvPrecisionBytes,
} = require('../../advanced-args.js');

describe('kvPrecisionBytes (Req 2.4)', () => {
  describe('KV_PRECISION_BYTES table', () => {
    it('exposes exactly the seven documented entries', () => {
      // Use sort() to make the assertion order-independent while still catching
      // any accidental addition or removal of keys.
      expect(Object.keys(KV_PRECISION_BYTES).sort()).to.deep.equal(
        ['f16', 'f32', 'q4_0', 'q4_1', 'q5_0', 'q5_1', 'q8_0']
      );
    });

    it('is a frozen object (no accidental mutation)', () => {
      expect(Object.isFrozen(KV_PRECISION_BYTES)).to.equal(true);
    });

    it('maps each KV cache type to its exact byte cost', () => {
      // The numbers below are the canonical bytes-per-element costs from the
      // design glossary and Req 2.4. They must match exactly - downstream
      // monotonicity properties (P47) depend on these specific ratios.
      expect(KV_PRECISION_BYTES.f32).to.equal(4);
      expect(KV_PRECISION_BYTES.f16).to.equal(2);
      expect(KV_PRECISION_BYTES.q8_0).to.equal(1);
      expect(KV_PRECISION_BYTES.q5_1).to.equal(0.75);
      expect(KV_PRECISION_BYTES.q5_0).to.equal(0.625);
      expect(KV_PRECISION_BYTES.q4_1).to.equal(0.5625);
      expect(KV_PRECISION_BYTES.q4_0).to.equal(0.5);
    });
  });

  describe('kvPrecisionBytes(kvCacheType) - accept path', () => {
    it('returns the exact byte cost for each of the seven legal values', () => {
      // Mirror each entry of the table through the function to confirm the
      // lookup path returns the same value as direct indexing.
      expect(kvPrecisionBytes('f32')).to.equal(4);
      expect(kvPrecisionBytes('f16')).to.equal(2);
      expect(kvPrecisionBytes('q8_0')).to.equal(1);
      expect(kvPrecisionBytes('q5_1')).to.equal(0.75);
      expect(kvPrecisionBytes('q5_0')).to.equal(0.625);
      expect(kvPrecisionBytes('q4_1')).to.equal(0.5625);
      expect(kvPrecisionBytes('q4_0')).to.equal(0.5);
    });

    it('returns strictly positive finite numbers for every legal value', () => {
      for (const key of Object.keys(KV_PRECISION_BYTES)) {
        const value = kvPrecisionBytes(key);
        expect(value).to.be.a('number');
        expect(Number.isFinite(value)).to.equal(true);
        expect(value).to.be.greaterThan(0);
      }
    });
  });

  describe('kvPrecisionBytes(kvCacheType) - reject path', () => {
    it('throws UnknownKvCacheTypeError for unknown strings', () => {
      const unknownStrings = [
        '',
        'F16',       // wrong case (keys are lower-case)
        'f16 ',      // trailing whitespace
        ' f16',      // leading whitespace
        'q4',        // truncated
        'q4_2',      // not a member
        'int8',      // plausible-but-wrong name
        'bf16',      // plausible-but-wrong name
        'toString',  // would hit Object.prototype without the own-property guard
        '__proto__', // would hit Object.prototype without the own-property guard
      ];

      for (const s of unknownStrings) {
        expect(() => kvPrecisionBytes(s))
          .to.throw(UnknownKvCacheTypeError)
          .with.property('value', s);
      }
    });

    it('throws UnknownKvCacheTypeError for null', () => {
      expect(() => kvPrecisionBytes(null))
        .to.throw(UnknownKvCacheTypeError)
        .with.property('value', null);
    });

    it('throws UnknownKvCacheTypeError for undefined', () => {
      // Also covers the no-argument call - `undefined` is the default.
      expect(() => kvPrecisionBytes(undefined))
        .to.throw(UnknownKvCacheTypeError)
        .with.property('value', undefined);
      expect(() => kvPrecisionBytes())
        .to.throw(UnknownKvCacheTypeError)
        .with.property('value', undefined);
    });

    it('throws UnknownKvCacheTypeError for numbers', () => {
      // Numeric inputs should never coerce to the string keys, even when the
      // number happens to look like a plausible precision (0.5, 2, 4, etc.).
      const numericInputs = [0, 1, 2, 4, 0.5, 0.625, 0.75, -1, NaN, Infinity];
      for (const n of numericInputs) {
        const err = (() => {
          try {
            kvPrecisionBytes(n);
            return null;
          } catch (e) {
            return e;
          }
        })();
        expect(err, `expected throw for numeric input ${n}`).to.be.instanceOf(UnknownKvCacheTypeError);
        // Use Object.is so NaN compares equal to NaN.
        expect(Object.is(err.value, n)).to.equal(true);
      }
    });

    it('sets name to "UnknownKvCacheTypeError" on thrown errors', () => {
      try {
        kvPrecisionBytes('not-a-type');
        expect.fail('expected throw');
      } catch (err) {
        expect(err).to.be.instanceOf(UnknownKvCacheTypeError);
        expect(err).to.be.instanceOf(Error);
        expect(err.name).to.equal('UnknownKvCacheTypeError');
      }
    });
  });
});
