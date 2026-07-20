/* eslint-env node */
/**
 * fast-check arbitraries for the phase-2 memory-tuning extensions to
 * `Advanced_Args` (design §1, Reqs 1.1, 2.1, 3.1, 4.1).
 *
 * The phase-1 property tests (P13–P15, P32) inline their own Advanced_Args
 * generators. Phase-2 needs a shared helper because **every** memory-tuning
 * property (P35–P40, P42, P46–P49, P61–P65) has to vary the same five new
 * fields:
 *
 *   - `nGpuLayers` : integer in `[-1, 999]`                       (Req 1.1)
 *   - `typeK`      : one of the seven KV cache types              (Req 2.1)
 *   - `typeV`      : one of the seven KV cache types              (Req 2.1)
 *   - `nCpuMoe`    : integer in `[0, 999]`                        (Req 3.1)
 *   - `threads`    : integer in `[1, 256]`                        (Req 4.1)
 *
 * Three layers of arbitraries are exposed so callers can pick the narrowest
 * shape their test needs:
 *
 *   1. **Individual field arbitraries** (`arbNGpuLayers`, `arbTypeK`,
 *      `arbTypeV`, `arbNCpuMoe`, `arbThreads`). Used by per-field properties
 *      (e.g. P36 "buildArgs -ngl contribution" only varies `nGpuLayers`).
 *
 *   2. **Memory-only record** (`arbMemoryAdvancedFields`). The five new
 *      fields assembled into a single `{ nGpuLayers, typeK, typeV, nCpuMoe,
 *      threads }` object. Used by P65 (JSON round-trip) and by callers who
 *      want to splat the memory block onto an existing phase-1 base.
 *
 *   3. **Full composed generator** (`arbAdvancedArgsExtended`). A complete
 *      `Advanced_Args` object satisfying the extended `validateAdvancedArgs`
 *      (the phase-1 checks plus the five phase-2 checks) by construction.
 *      Used by P35 (schema closure) and P15-style closure properties.
 *
 * The composed generator mirrors the inline phase-1 arbitraries used by
 * P15 / P32 (identical field ranges and `speculative.enabled === false`
 * to avoid the file-existence check in `validateAdvancedArgs`) and then
 * layers the five memory fields on top. Every sample it produces is
 * guaranteed to pass `validateAdvancedArgs` — that invariant is asserted
 * by the self-test at the bottom of this file and re-checked by the
 * P35 property.
 *
 * The helper does **not** import from `../../advanced-args` so that
 * generator output can be cross-checked against oracle implementations
 * even when the production module under test is mid-refactor; the seven
 * KV cache type strings are re-declared locally and must stay in lock-step
 * with `KV_PRECISION_BYTES`.
 *
 * Supports: P35, P36, P37, P40, P42, P46, P47, P48, P49, P61, P62, P63,
 *           P64, P65.
 *
 * @module tests/helpers/arb-memory-advanced-args
 */

'use strict';

const fc = require('fast-check');

/**
 * The seven KV cache types recognised by `KV_PRECISION_BYTES` (design §1,
 * Req 2.4). Kept as a frozen array so every call site shares the same
 * reference and cannot mutate the list at runtime.
 *
 * Must stay in sync with `advanced-args.js`' `KV_PRECISION_BYTES` and with
 * `tests/helpers/arb-estimate-args.js`' `KV_CACHE_TYPES`.
 *
 * @type {ReadonlyArray<'f32'|'f16'|'q8_0'|'q5_1'|'q5_0'|'q4_1'|'q4_0'>}
 */
const KV_CACHE_TYPES = Object.freeze([
  'f32',
  'f16',
  'q8_0',
  'q5_1',
  'q5_0',
  'q4_1',
  'q4_0',
]);

// ---------------------------------------------------------------------------
// Individual field arbitraries (memory-tuning block)
// ---------------------------------------------------------------------------

/**
 * `nGpuLayers` : integer in `[-1, 999]` inclusive (Req 1.1).
 *
 * The `-1` sentinel means "let llama-server decide" (emits no `-ngl` flag).
 * Exposed as a weighted union so the sentinel and the `0` (no-offload) edge
 * are each sampled more often than a uniform draw over 1001 values would
 * produce.
 */
const arbNGpuLayers = fc.oneof(
  { weight: 2, arbitrary: fc.constant(-1) },
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 6, arbitrary: fc.integer({ min: -1, max: 999 }) },
);

/**
 * Single KV cache type, uniformly sampled from the seven-value set.
 *
 * `typeK` and `typeV` are drawn independently so every 7 × 7 combination
 * (including matched `f16/f16` and asymmetric `q4_0/f16`) is reachable.
 */
const arbKvCacheType = fc.constantFrom(...KV_CACHE_TYPES);

/** `typeK` : one of the seven KV cache types (Req 2.1). */
const arbTypeK = arbKvCacheType;

/** `typeV` : one of the seven KV cache types (Req 2.1). */
const arbTypeV = arbKvCacheType;

/**
 * `nCpuMoe` : integer in `[0, 999]` inclusive (Req 3.1).
 *
 * `0` disables the flag; weighted so the "no-offload" edge and the
 * "non-zero" branch both show up in short campaigns.
 */
const arbNCpuMoe = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 999 }) },
);

/**
 * `threads` : integer in `[1, 256]` inclusive (Req 4.1).
 *
 * Upper bound matches `detectPhysicalCores`' clamp; lower bound is 1 so
 * `-t 0` is never generated (llama-server rejects it).
 */
const arbThreads = fc.integer({ min: 1, max: 256 });

/**
 * Record of the five phase-2 memory fields. Use this when you want the
 * memory block on its own — e.g. for JSON round-trip tests (P65) that
 * only care about the new keys surviving the serialise/parse cycle.
 */
const arbMemoryAdvancedFields = fc.record({
  nGpuLayers: arbNGpuLayers,
  typeK: arbTypeK,
  typeV: arbTypeV,
  nCpuMoe: arbNCpuMoe,
  threads: arbThreads,
});

// ---------------------------------------------------------------------------
// Phase-1 base arbitrary (inlined so this helper is self-contained)
// ---------------------------------------------------------------------------

/**
 * Generates a phase-1-valid `Advanced_Args` base. Identical field ranges
 * to the inline arbitraries used by P15 and P32, with two deliberate
 * pinnings to keep every sample self-consistent:
 *
 *   - `ubatchSize` is post-clamped to `min(ubatchSize, batchSize)` so the
 *     `ubatchSize <= batchSize` invariant (Req 9.6) always holds.
 *   - `speculative.enabled` is pinned to `false` with `draftModel: null`
 *     so `validateAdvancedArgs` does not fall into the file-existence
 *     check (Req 12.3). Speculative decoding is orthogonal to memory
 *     tuning; property tests that need `speculative.enabled === true`
 *     can layer their own override on top of this base.
 *
 * @returns {fc.Arbitrary<object>}
 */
const arbAdvancedArgsPhase1Base = fc
  .record({
    flashAttn: fc.boolean(),
    mmap: fc.boolean(),
    mlock: fc.boolean(),
    ctxSize: fc.integer({ min: 512, max: 32768 }),
    batchSize: fc.integer({ min: 32, max: 4096 }),
    ubatchSize: fc.integer({ min: 32, max: 4096 }),
    parallel: fc.integer({ min: 1, max: 16 }),
    tensorSplit: fc.array(fc.float({ min: 0, max: 1, noNaN: true }), {
      maxLength: 8,
    }),
    mainGpu: fc.integer({ min: 0, max: 8 }),
    splitMode: fc.constantFrom('none', 'layer', 'row'),
    rpc: fc.array(
      fc
        .tuple(fc.domain(), fc.integer({ min: 1024, max: 65535 }))
        .map(([host, port]) => `${host}:${port}`),
      { maxLength: 4 },
    ),
    contBatching: fc.boolean(),
    sampling: fc.record({
      temp: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
      topK: fc.integer({ min: 0, max: 1000 }),
      topP: fc.float({ min: 0.0, max: 1.0, noNaN: true }),
      repeatPenalty: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
      presencePenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
      frequencyPenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
      seed: fc.integer({ min: -1, max: 2147483647 }),
    }),    speculative: fc.record({
      // Pinned to false so validateAdvancedArgs does not reach the
      // file-existence check (Req 12.3). Property tests that need
      // speculative decoding must override this key themselves.
      enabled: fc.constant(false),
      draftModel: fc.constant(null),
      draftCtxSize: fc.integer({ min: 512, max: 32768 }),
    }),
  })
  .map((r) => ({
    ...r,
    ubatchSize: Math.min(r.ubatchSize, r.batchSize),
    // Canonicalise signed-zero floats in sampling params. `JSON.stringify`
    // collapses -0 → 0, so a sample containing `-0` would break the P65
    // round-trip deep-equality check even though the values are
    // mathematically identical. Normalising at generation time keeps the
    // arbitrary stable against JSON serialisation without weakening the
    // round-trip property.
    sampling: {
      ...r.sampling,
      temp: Object.is(r.sampling.temp, -0) ? 0 : r.sampling.temp,
      topP: Object.is(r.sampling.topP, -0) ? 0 : r.sampling.topP,
      repeatPenalty: Object.is(r.sampling.repeatPenalty, -0)
        ? 0
        : r.sampling.repeatPenalty,
      presencePenalty: Object.is(r.sampling.presencePenalty, -0)
        ? 0
        : r.sampling.presencePenalty,
      frequencyPenalty: Object.is(r.sampling.frequencyPenalty, -0)
        ? 0
        : r.sampling.frequencyPenalty,
    },
  }));

// ---------------------------------------------------------------------------
// Composed extended arbitrary (phase-1 base + phase-2 memory block)
// ---------------------------------------------------------------------------

/**
 * Full extended `Advanced_Args`: phase-1 base + five phase-2 memory fields.
 *
 * Every sample satisfies the extended `validateAdvancedArgs` (phase-1 checks
 * plus the phase-2 checks for `nGpuLayers`, `typeK`, `typeV`, `nCpuMoe`,
 * `threads`). That invariant is the main reason callers should prefer this
 * arbitrary over assembling one by hand.
 *
 * Use this for:
 *   - P35 (schema closure on the extended shape).
 *   - P36, P37, P40, P42 (buildArgs single-emission per-flag contributions —
 *     need a full valid Advanced_Args even though only one field drives the
 *     assertion).
 *   - P61–P64 (preset-recommender output validity under varied inputs).
 *   - P65 (JSON round-trip including the five new keys).
 *
 * @returns {fc.Arbitrary<object>}
 */
const arbAdvancedArgsExtended = fc
  .record({
    base: arbAdvancedArgsPhase1Base,
    memory: arbMemoryAdvancedFields,
  })
  .map(({ base, memory }) => ({ ...base, ...memory }));

module.exports = {
  // Constants
  KV_CACHE_TYPES,
  // Individual field arbitraries (memory-tuning block)
  arbNGpuLayers,
  arbKvCacheType,
  arbTypeK,
  arbTypeV,
  arbNCpuMoe,
  arbThreads,
  // Grouped memory-only record
  arbMemoryAdvancedFields,
  // Phase-1 base (exposed so callers can compose their own layers)
  arbAdvancedArgsPhase1Base,
  // Full composed arbitrary (phase-1 + phase-2)
  arbAdvancedArgsExtended,
};
