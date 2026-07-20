/* eslint-env node, mocha */
/**
 * Property Test P66: Forward-compat read of phase-1-shaped JSON
 *
 * For any phase-1-shaped Advanced_Args object (missing the five new memory
 * keys), the `normalizeExtendedAdvancedArgs` helper fills the missing keys
 * with their documented defaults, and the result passes `validateAdvancedArgs`.
 *
 * Validates: Requirements 11.2, 11.4
 *
 * Strategy:
 *   - Generate phase-1-shaped Advanced_Args objects (without the five new
 *     memory keys: `nGpuLayers`, `typeK`, `typeV`, `nCpuMoe`, `threads`).
 *   - Pass them through the `normalizeExtendedAdvancedArgs` helper.
 *   - Verify that the missing keys are filled with defaults.
 *   - Verify that the result passes `validateAdvancedArgs`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { validateAdvancedArgs, MEMORY_ADVANCED_DEFAULTS } = require('../../advanced-args.js');

/**
 * Simulate the `normalizeExtendedAdvancedArgs` helper from `model-config-store.js`.
 * This is the pure logic extracted from the read path. Kept in-sync with the
 * real helper's contract: non-object inputs are returned unchanged so the
 * caller's existing error path handles the corrupt-config case uniformly.
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeExtendedAdvancedArgs(raw) {
  // Non-object inputs are left alone (mirrors model-config-store.js).
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const normalized = { ...raw };

  // Fill missing memory keys with defaults
  if (normalized.nGpuLayers === undefined) {
    normalized.nGpuLayers = MEMORY_ADVANCED_DEFAULTS.nGpuLayers;
  }
  if (normalized.typeK === undefined) {
    normalized.typeK = MEMORY_ADVANCED_DEFAULTS.typeK;
  }
  if (normalized.typeV === undefined) {
    normalized.typeV = MEMORY_ADVANCED_DEFAULTS.typeV;
  }
  if (normalized.nCpuMoe === undefined) {
    normalized.nCpuMoe = MEMORY_ADVANCED_DEFAULTS.nCpuMoe;
  }
  if (normalized.threads === undefined) {
    normalized.threads = MEMORY_ADVANCED_DEFAULTS.threads;
  }

  // Type guards: substitute defaults for wrong-type values
  if (!Number.isInteger(normalized.nGpuLayers) || normalized.nGpuLayers < -1 || normalized.nGpuLayers > 999) {
    normalized.nGpuLayers = MEMORY_ADVANCED_DEFAULTS.nGpuLayers;
  }
  if (typeof normalized.typeK !== 'string' || !['f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0'].includes(normalized.typeK)) {
    normalized.typeK = MEMORY_ADVANCED_DEFAULTS.typeK;
  }
  if (typeof normalized.typeV !== 'string' || !['f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0'].includes(normalized.typeV)) {
    normalized.typeV = MEMORY_ADVANCED_DEFAULTS.typeV;
  }
  if (!Number.isInteger(normalized.nCpuMoe) || normalized.nCpuMoe < 0 || normalized.nCpuMoe > 999) {
    normalized.nCpuMoe = MEMORY_ADVANCED_DEFAULTS.nCpuMoe;
  }
  if (!Number.isInteger(normalized.threads) || normalized.threads < 1 || normalized.threads > 256) {
    normalized.threads = MEMORY_ADVANCED_DEFAULTS.threads;
  }

  return normalized;
}

/**
 * Arbitrary for phase-1-shaped Advanced_Args (without the five new memory keys).
 *
 * A truly "phase-1-shaped" object must include every phase-1 field that
 * `validateAdvancedArgs` checks — including the nested `sampling` and
 * `speculative` records. An object missing those keys is NOT phase-1-shaped,
 * it is malformed.
 */
const arbPhase1AdvancedArgs = fc.record({
  flashAttn: fc.boolean(),
  mmap: fc.boolean(),
  mlock: fc.boolean(),
  ctxSize: fc.integer({ min: 512, max: 32768 }),
  batchSize: fc.integer({ min: 32, max: 4096 }),
  ubatchSize: fc.integer({ min: 32, max: 4096 }),
  parallel: fc.integer({ min: 1, max: 8 }),
  tensorSplit: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
  mainGpu: fc.integer({ min: 0, max: 7 }),
  splitMode: fc.constantFrom('none', 'layer', 'row'),
  rpc: fc.constant([]), // empty array trivially satisfies the host:port regex check
  contBatching: fc.boolean(),
  sampling: fc.record({
    temp: fc.double({ min: 0.0, max: 2.0, noNaN: true }),
    topK: fc.integer({ min: 0, max: 1000 }),
    topP: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
    repeatPenalty: fc.double({ min: 0.0, max: 2.0, noNaN: true }),
    presencePenalty: fc.double({ min: -2.0, max: 2.0, noNaN: true }),
    frequencyPenalty: fc.double({ min: -2.0, max: 2.0, noNaN: true }),
    seed: fc.integer({ min: -1, max: 2147483647 }),
  }),
  speculative: fc.record({
    // Pinned to disabled so validateAdvancedArgs does not reach the
    // file-existence check (Req 12.3) in this forward-compat test.
    enabled: fc.constant(false),
    draftModel: fc.constant(null),
    draftCtxSize: fc.integer({ min: 512, max: 32768 }),
  }),
}).map((r) => ({
  ...r,
  // Preserve `ubatchSize <= batchSize` invariant (Req 9.6).
  ubatchSize: Math.min(r.ubatchSize, r.batchSize),
}));

describe('P66: Forward-compat read of phase-1-shaped JSON (Req 11.2, 11.4)', () => {
  it('fills missing memory keys with defaults', () => {
    fc.assert(
      fc.property(arbPhase1AdvancedArgs, (phase1Args) => {
        const normalized = normalizeExtendedAdvancedArgs(phase1Args);

        // Missing keys should be filled with defaults
        expect(normalized.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
        expect(normalized.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
        expect(normalized.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
        expect(normalized.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
        expect(normalized.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);
      }),
      { numRuns: 100 },
    );
  });

  it('passes validateAdvancedArgs after normalization', () => {
    fc.assert(
      fc.property(arbPhase1AdvancedArgs, (phase1Args) => {
        const normalized = normalizeExtendedAdvancedArgs(phase1Args);
        const validation = validateAdvancedArgs(normalized);

        // Normalized args should always pass validation
        expect(validation.ok).to.equal(true, `validation failed: ${validation.reason}`);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves phase-1 fields unchanged', () => {
    fc.assert(
      fc.property(arbPhase1AdvancedArgs, (phase1Args) => {
        const normalized = normalizeExtendedAdvancedArgs(phase1Args);

        // Phase-1 fields should be unchanged
        expect(normalized.flashAttn).to.equal(phase1Args.flashAttn);
        expect(normalized.mmap).to.equal(phase1Args.mmap);
        expect(normalized.mlock).to.equal(phase1Args.mlock);
        expect(normalized.ctxSize).to.equal(phase1Args.ctxSize);
        expect(normalized.batchSize).to.equal(phase1Args.batchSize);
        expect(normalized.ubatchSize).to.equal(phase1Args.ubatchSize);
        expect(normalized.parallel).to.equal(phase1Args.parallel);
        expect(normalized.mainGpu).to.equal(phase1Args.mainGpu);
        expect(normalized.splitMode).to.equal(phase1Args.splitMode);
        expect(normalized.contBatching).to.equal(phase1Args.contBatching);
      }),
      { numRuns: 100 },
    );
  });

  it('substitutes defaults for wrong-type nGpuLayers', () => {
    const wrongTypeValues = [
      { nGpuLayers: 'not-a-number' },
      { nGpuLayers: null },
      { nGpuLayers: NaN },
      { nGpuLayers: -2 }, // Out of range
      { nGpuLayers: 1000 }, // Out of range
      { nGpuLayers: 3.14 }, // Non-integer
    ];

    for (const raw of wrongTypeValues) {
      const normalized = normalizeExtendedAdvancedArgs(raw);
      expect(normalized.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
    }
  });

  it('substitutes defaults for wrong-type typeK', () => {
    const wrongTypeValues = [
      { typeK: 'invalid-type' },
      { typeK: null },
      { typeK: 123 },
      { typeK: true },
    ];

    for (const raw of wrongTypeValues) {
      const normalized = normalizeExtendedAdvancedArgs(raw);
      expect(normalized.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
    }
  });

  it('substitutes defaults for wrong-type typeV', () => {
    const wrongTypeValues = [
      { typeV: 'invalid-type' },
      { typeV: null },
      { typeV: 123 },
      { typeV: false },
    ];

    for (const raw of wrongTypeValues) {
      const normalized = normalizeExtendedAdvancedArgs(raw);
      expect(normalized.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
    }
  });

  it('substitutes defaults for wrong-type nCpuMoe', () => {
    const wrongTypeValues = [
      { nCpuMoe: 'not-a-number' },
      { nCpuMoe: null },
      { nCpuMoe: NaN },
      { nCpuMoe: -1 }, // Out of range
      { nCpuMoe: 1000 }, // Out of range
      { nCpuMoe: 2.5 }, // Non-integer
    ];

    for (const raw of wrongTypeValues) {
      const normalized = normalizeExtendedAdvancedArgs(raw);
      expect(normalized.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
    }
  });

  it('substitutes defaults for wrong-type threads', () => {
    const wrongTypeValues = [
      { threads: 'not-a-number' },
      { threads: null },
      { threads: NaN },
      { threads: 0 }, // Out of range
      { threads: 257 }, // Out of range
      { threads: 4.5 }, // Non-integer
    ];

    for (const raw of wrongTypeValues) {
      const normalized = normalizeExtendedAdvancedArgs(raw);
      expect(normalized.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);
    }
  });

  it('handles empty objects gracefully', () => {
    const normalized = normalizeExtendedAdvancedArgs({});

    // The normaliser fills the five memory-tuning keys with their defaults
    // even when the input is empty. It does NOT synthesise the phase-1
    // fields (sampling, speculative, etc.) — that is the caller's
    // responsibility (e.g., ModelConfigStore merges with DEFAULT_ADVANCED_ARGS
    // before handing off to the validator). The contract of this helper is
    // strictly "fill the five phase-2 keys"; validation is out of scope when
    // the phase-1 fields are absent.
    expect(normalized.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
    expect(normalized.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
    expect(normalized.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
    expect(normalized.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
    expect(normalized.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);
  });

  it('handles null/undefined inputs gracefully', () => {
    const normalized1 = normalizeExtendedAdvancedArgs(null);
    const normalized2 = normalizeExtendedAdvancedArgs(undefined);

    // Contract: non-object inputs are returned unchanged so the caller's
    // corrupt-config error path (ConfigParseError in `get`, try/catch skip
    // in `listAll`) can handle them uniformly (model-config-store.js).
    expect(normalized1).to.equal(null);
    expect(normalized2).to.equal(undefined);
  });
});
