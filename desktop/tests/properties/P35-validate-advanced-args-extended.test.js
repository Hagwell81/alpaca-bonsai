/**
 * Property 35: validateAdvancedArgs schema closure (extended)
 *
 * For any object `a` that passes the phase-1 `validateAdvancedArgs`,
 * extended-`validateAdvancedArgs(a)` returns `{ ok: true }` iff:
 *   - `a.nGpuLayers` is an integer in `[-1, 999]`, AND
 *   - `a.typeK` and `a.typeV` are strings in
 *     `{ 'f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0' }`, AND
 *   - `a.nCpuMoe` is an integer in `[0, 999]`, AND
 *   - `a.threads` is an integer in `[1, 256]`.
 *
 * When the validator returns `{ ok: false }`, the `field` names the first
 * failing constraint in the order listed above, preferring the leftmost
 * phase-1 constraint when any phase-1 branch fails first.
 *
 * This file covers both directions:
 *   - Accept direction: every sample from `arbAdvancedArgsExtended` passes.
 *   - Reject direction: if one of the five phase-2 fields is replaced by an
 *     out-of-range / wrong-type value, the validator returns
 *     `{ ok: false, field: <that field> }` (all other phase-1 fields remain
 *     valid so the phase-2 check is the first to fire).
 *
 * Validates: Requirements 1.1, 1.5, 2.1, 2.3, 3.1, 3.4, 4.1, 4.4
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  validateAdvancedArgs,
  DEFAULT_ADVANCED_ARGS,
  KV_PRECISION_BYTES,
} = require('../../advanced-args');

const {
  arbAdvancedArgsExtended,
  KV_CACHE_TYPES,
} = require('../helpers/arb-memory-advanced-args');

/**
 * Set of valid KV cache strings, used as a filter/predicate when generating
 * invalid `typeK` / `typeV` values.
 */
const VALID_KV = new Set(KV_CACHE_TYPES);

// ---------------------------------------------------------------------------
// Invalid-value arbitraries, one per phase-2 field
// ---------------------------------------------------------------------------

/**
 * Out-of-range / wrong-type values for `nGpuLayers` (Req 1.5).
 * Covers: integers below -1, integers above 999, non-integer numbers,
 * non-number primitives, and special numeric values (NaN, Infinity).
 */
const arbInvalidNGpuLayers = fc.oneof(
  // Below lower bound
  fc.integer({ min: -1000000, max: -2 }),
  // Above upper bound
  fc.integer({ min: 1000, max: 1000000 }),
  // Non-integer number in the otherwise-legal numeric range
  fc
    .double({ min: -0.99, max: 998.99, noNaN: true })
    .filter((n) => !Number.isInteger(n)),
  // Non-number wrong-type values
  fc.constantFrom(null, undefined, 'not-a-number', true, false, [], {}),
  // Special numeric values
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

/**
 * Invalid values for `typeK` (Req 2.3): strings outside the seven-value set,
 * as well as wrong-type primitives. Strings are filtered so they cannot
 * accidentally collide with a valid member.
 */
const arbInvalidTypeK = fc.oneof(
  fc.string().filter((s) => !VALID_KV.has(s)),
  fc.constantFrom(null, undefined, 0, 1, 2, true, false, [], {}),
);

/** Invalid values for `typeV` (Req 2.3). Same shape as `arbInvalidTypeK`. */
const arbInvalidTypeV = arbInvalidTypeK;

/**
 * Out-of-range / wrong-type values for `nCpuMoe` (Req 3.4).
 * Covers: integers below 0, integers above 999, non-integer numbers,
 * wrong-type primitives, and special numeric values.
 */
const arbInvalidNCpuMoe = fc.oneof(
  fc.integer({ min: -1000000, max: -1 }),
  fc.integer({ min: 1000, max: 1000000 }),
  fc
    .double({ min: 0.01, max: 998.99, noNaN: true })
    .filter((n) => !Number.isInteger(n)),
  fc.constantFrom(null, undefined, 'not-a-number', true, false, [], {}),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

/**
 * Out-of-range / wrong-type values for `threads` (Req 4.4).
 * Covers: integers below 1, integers above 256, non-integer numbers,
 * wrong-type primitives, and special numeric values.
 */
const arbInvalidThreads = fc.oneof(
  fc.integer({ min: -1000000, max: 0 }),
  fc.integer({ min: 257, max: 1000000 }),
  fc
    .double({ min: 1.01, max: 255.99, noNaN: true })
    .filter((n) => !Number.isInteger(n)),
  fc.constantFrom(null, undefined, 'not-a-number', true, false, [], {}),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('P35: validateAdvancedArgs schema closure (extended)', () => {
  // -------------------------------------------------------------------------
  // Smoke checks on the helper's invariants
  // -------------------------------------------------------------------------

  it('DEFAULT_ADVANCED_ARGS passes the extended validator', () => {
    const result = validateAdvancedArgs(DEFAULT_ADVANCED_ARGS);
    expect(result).to.deep.equal({ ok: true });
  });

  it('KV_CACHE_TYPES is exactly the KV_PRECISION_BYTES key set', () => {
    expect([...KV_CACHE_TYPES].sort()).to.deep.equal(
      Object.keys(KV_PRECISION_BYTES).sort(),
    );
  });

  // -------------------------------------------------------------------------
  // Accept direction (Reqs 1.1, 2.1, 3.1, 4.1)
  //
  // Every sample produced by `arbAdvancedArgsExtended` is, by construction,
  // a valid extended Advanced_Args. The validator must return `{ ok: true }`
  // on every such sample — this is the "closure" direction of P35.
  // -------------------------------------------------------------------------

  it('accepts every sample from arbAdvancedArgsExtended', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, (args) => {
        const result = validateAdvancedArgs(args);
        expect(result).to.deep.equal({ ok: true });
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Reject direction (Reqs 1.5, 2.3, 3.4, 4.4)
  //
  // Starting from a valid sample, replace exactly one of the five phase-2
  // fields with a generator-chosen invalid value and assert the validator
  // reports the expected `field`. All phase-1 fields remain untouched so
  // the phase-2 branch is the first to fire — which is what the design's
  // "leftmost phase-1 constraint wins otherwise" wording captures.
  // -------------------------------------------------------------------------

  it('rejects out-of-range / wrong-type nGpuLayers with field="nGpuLayers"', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, arbInvalidNGpuLayers, (base, bad) => {
        const args = { ...base, nGpuLayers: bad };
        const result = validateAdvancedArgs(args);
        expect(result.ok).to.equal(false);
        expect(result.field).to.equal('nGpuLayers');
        expect(result.reason).to.be.a('string').and.not.empty;
      }),
      { numRuns: 100 },
    );
  });

  it('rejects out-of-set / wrong-type typeK with field="typeK"', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, arbInvalidTypeK, (base, bad) => {
        const args = { ...base, typeK: bad };
        const result = validateAdvancedArgs(args);
        expect(result.ok).to.equal(false);
        expect(result.field).to.equal('typeK');
        expect(result.reason).to.be.a('string').and.not.empty;
      }),
      { numRuns: 100 },
    );
  });

  it('rejects out-of-set / wrong-type typeV with field="typeV"', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, arbInvalidTypeV, (base, bad) => {
        // typeK remains a valid member so the typeV check is the one that fires.
        const args = { ...base, typeV: bad };
        const result = validateAdvancedArgs(args);
        expect(result.ok).to.equal(false);
        expect(result.field).to.equal('typeV');
        expect(result.reason).to.be.a('string').and.not.empty;
      }),
      { numRuns: 100 },
    );
  });

  it('rejects out-of-range / wrong-type nCpuMoe with field="nCpuMoe"', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, arbInvalidNCpuMoe, (base, bad) => {
        const args = { ...base, nCpuMoe: bad };
        const result = validateAdvancedArgs(args);
        expect(result.ok).to.equal(false);
        expect(result.field).to.equal('nCpuMoe');
        expect(result.reason).to.be.a('string').and.not.empty;
      }),
      { numRuns: 100 },
    );
  });

  it('rejects out-of-range / wrong-type threads with field="threads"', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, arbInvalidThreads, (base, bad) => {
        const args = { ...base, threads: bad };
        const result = validateAdvancedArgs(args);
        expect(result.ok).to.equal(false);
        expect(result.field).to.equal('threads');
        expect(result.reason).to.be.a('string').and.not.empty;
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Boundary-value examples
  //
  // Property runs explore the interior of the valid domain; the cases below
  // pin down the four exact boundaries the design document calls out.
  // -------------------------------------------------------------------------

  it('accepts boundary values at the edges of each phase-2 range', () => {
    const boundaries = [
      { nGpuLayers: -1 },
      { nGpuLayers: 0 },
      { nGpuLayers: 999 },
      { nCpuMoe: 0 },
      { nCpuMoe: 999 },
      { threads: 1 },
      { threads: 256 },
      ...KV_CACHE_TYPES.map((t) => ({ typeK: t })),
      ...KV_CACHE_TYPES.map((t) => ({ typeV: t })),
    ];
    for (const overlay of boundaries) {
      const args = { ...DEFAULT_ADVANCED_ARGS, ...overlay };
      const result = validateAdvancedArgs(args);
      expect(result).to.deep.equal(
        { ok: true },
        `expected overlay ${JSON.stringify(overlay)} to validate`,
      );
    }
  });

  it('rejects values one step outside each numeric boundary', () => {
    const cases = [
      { field: 'nGpuLayers', overlay: { nGpuLayers: -2 } },
      { field: 'nGpuLayers', overlay: { nGpuLayers: 1000 } },
      { field: 'nCpuMoe', overlay: { nCpuMoe: -1 } },
      { field: 'nCpuMoe', overlay: { nCpuMoe: 1000 } },
      { field: 'threads', overlay: { threads: 0 } },
      { field: 'threads', overlay: { threads: 257 } },
    ];
    for (const { field, overlay } of cases) {
      const args = { ...DEFAULT_ADVANCED_ARGS, ...overlay };
      const result = validateAdvancedArgs(args);
      expect(result.ok).to.equal(
        false,
        `expected overlay ${JSON.stringify(overlay)} to be rejected`,
      );
      expect(result.field).to.equal(field);
    }
  });
});
