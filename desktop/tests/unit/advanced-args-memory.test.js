/**
 * Unit tests for the extended validateAdvancedArgs schema checks
 * (advanced-args.js).
 *
 * Covers the five memory-tuning fields added in phase-2 (Reqs 1.1, 1.5, 2.1,
 * 2.3, 3.1, 3.4, 4.1, 4.4):
 *
 *   nGpuLayers: integer in [-1, 999]
 *   typeK:      one of f32, f16, q8_0, q5_1, q5_0, q4_1, q4_0
 *   typeV:      one of f32, f16, q8_0, q5_1, q5_0, q4_1, q4_0
 *   nCpuMoe:    integer in [0, 999]
 *   threads:    integer in [1, 256]
 *
 * For each new field: one accept (in-range) example, one out-of-range reject,
 * and one wrong-type reject. Every reject case asserts both the returned
 * `field` string (for inline UI highlighting, Req 10.3) and a non-empty
 * `reason` string (for the validator error message).
 *
 * Requirements: 1.1, 1.5, 2.1, 2.3, 3.1, 3.4, 4.1, 4.4
 */

const { expect } = require('chai');
const {
  DEFAULT_ADVANCED_ARGS,
  validateAdvancedArgs,
} = require('../../advanced-args.js');

/**
 * Build an Advanced_Args object derived from the documented defaults with the
 * given overrides merged in. The defaults already pass validateAdvancedArgs,
 * so any single-field override makes the validator's decision hinge on that
 * field alone.
 *
 * @param {Partial<import('../../advanced-args.js').AdvancedArgs>} overrides
 */
function argsWith(overrides) {
  return { ...DEFAULT_ADVANCED_ARGS, ...overrides };
}

/**
 * Assert a `{ ok: false, field, reason }` shape with the expected field and a
 * non-empty string reason. Kept local so each test can be read in isolation.
 *
 * @param {ReturnType<typeof validateAdvancedArgs>} result
 * @param {string} expectedField
 */
function expectReject(result, expectedField) {
  expect(result).to.be.an('object');
  expect(result.ok).to.equal(false);
  expect(result.field).to.equal(expectedField);
  expect(result.reason).to.be.a('string').and.not.equal('');
}

describe('validateAdvancedArgs - memory-tuning fields', () => {
  // Sanity anchor: the shared baseline must itself be valid, otherwise every
  // single-field override test below would fail for the wrong reason.
  it('DEFAULT_ADVANCED_ARGS passes validation (baseline)', () => {
    expect(validateAdvancedArgs(DEFAULT_ADVANCED_ARGS)).to.deep.equal({ ok: true });
  });

  // -------------------------------------------------------------------------
  // nGpuLayers - integer in [-1, 999] (Reqs 1.1, 1.5)
  // -------------------------------------------------------------------------
  describe('nGpuLayers (Reqs 1.1, 1.5)', () => {
    it('accepts an in-range value', () => {
      // 32 is a plausible transformer layer count; strictly inside [-1, 999].
      const result = validateAdvancedArgs(argsWith({ nGpuLayers: 32 }));
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects an out-of-range value with field "nGpuLayers"', () => {
      // -2 is one below the documented lower bound of -1, so it is the
      // smallest out-of-range integer.
      const result = validateAdvancedArgs(argsWith({ nGpuLayers: -2 }));
      expectReject(result, 'nGpuLayers');
      expect(result.reason).to.include('[-1, 999]');
    });

    it('rejects a wrong-type value with field "nGpuLayers"', () => {
      // Fractional number is an explicit non-integer that still lies numerically
      // inside the range, exercising the Number.isInteger guard specifically.
      const result = validateAdvancedArgs(argsWith({ nGpuLayers: 1.5 }));
      expectReject(result, 'nGpuLayers');
    });
  });

  // -------------------------------------------------------------------------
  // typeK - one of the seven KV cache types (Reqs 2.1, 2.3)
  // -------------------------------------------------------------------------
  describe('typeK (Reqs 2.1, 2.3)', () => {
    it('accepts a legal KV cache type', () => {
      // q8_0 is the low-VRAM preset value (Req 9.3); exercising it confirms
      // the preset path cannot be rejected by the validator.
      const result = validateAdvancedArgs(argsWith({ typeK: 'q8_0' }));
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects an out-of-set value with field "typeK"', () => {
      // bf16 is a plausible-looking type name that is NOT in the seven-entry
      // set (a common mistake), so it is the canonical "unknown string" case.
      const result = validateAdvancedArgs(argsWith({ typeK: 'bf16' }));
      expectReject(result, 'typeK');
      expect(result.reason).to.include('f16');
    });

    it('rejects a wrong-type value with field "typeK"', () => {
      // Numeric 2 is the byte-cost for f16; feeding the byte count instead of
      // the string key is a realistic caller mistake the guard must reject.
      const result = validateAdvancedArgs(argsWith({ typeK: 2 }));
      expectReject(result, 'typeK');
    });
  });

  // -------------------------------------------------------------------------
  // typeV - one of the seven KV cache types (Reqs 2.1, 2.3)
  // -------------------------------------------------------------------------
  describe('typeV (Reqs 2.1, 2.3)', () => {
    it('accepts a legal KV cache type', () => {
      const result = validateAdvancedArgs(argsWith({ typeV: 'f32' }));
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects an out-of-set value with field "typeV"', () => {
      // Wrong-case key confirms the set membership check is case-sensitive.
      const result = validateAdvancedArgs(argsWith({ typeV: 'F16' }));
      expectReject(result, 'typeV');
      expect(result.reason).to.include('f16');
    });

    it('rejects a wrong-type value with field "typeV"', () => {
      // null is a common "missing value" sentinel that must be distinguished
      // from a valid string key.
      const result = validateAdvancedArgs(argsWith({ typeV: null }));
      expectReject(result, 'typeV');
    });
  });

  // -------------------------------------------------------------------------
  // nCpuMoe - integer in [0, 999] (Reqs 3.1, 3.4)
  // -------------------------------------------------------------------------
  describe('nCpuMoe (Reqs 3.1, 3.4)', () => {
    it('accepts an in-range value', () => {
      // 16 is a plausible MoE-offload layer count; strictly inside [0, 999].
      const result = validateAdvancedArgs(argsWith({ nCpuMoe: 16 }));
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects an out-of-range value with field "nCpuMoe"', () => {
      // 1000 is one above the documented upper bound, the smallest
      // out-of-range positive integer.
      const result = validateAdvancedArgs(argsWith({ nCpuMoe: 1000 }));
      expectReject(result, 'nCpuMoe');
      expect(result.reason).to.include('[0, 999]');
    });

    it('rejects a wrong-type value with field "nCpuMoe"', () => {
      // A string representation is the most common wrong-type case coming
      // from form inputs that forgot to parse numerically.
      const result = validateAdvancedArgs(argsWith({ nCpuMoe: '16' }));
      expectReject(result, 'nCpuMoe');
    });
  });

  // -------------------------------------------------------------------------
  // threads - integer in [1, 256] (Reqs 4.1, 4.4)
  // -------------------------------------------------------------------------
  describe('threads (Reqs 4.1, 4.4)', () => {
    it('accepts an in-range value', () => {
      // 8 is a plausible physical-core count; strictly inside [1, 256].
      const result = validateAdvancedArgs(argsWith({ threads: 8 }));
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects an out-of-range value with field "threads"', () => {
      // 0 is one below the documented lower bound of 1; the smallest
      // non-negative out-of-range value.
      const result = validateAdvancedArgs(argsWith({ threads: 0 }));
      expectReject(result, 'threads');
      expect(result.reason).to.include('[1, 256]');
    });

    it('rejects a wrong-type value with field "threads"', () => {
      // NaN is numerically "not in range" but also not an integer; exercises
      // the Number.isInteger guard specifically (NaN is a number but not int).
      const result = validateAdvancedArgs(argsWith({ threads: NaN }));
      expectReject(result, 'threads');
    });
  });
});
