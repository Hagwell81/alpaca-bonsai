/* eslint-env node */
/**
 * fast-check arbitraries for the extended `Slot_Config` shape consumed by
 * `SlotManager._buildChildEnv`, `validateSlotConfig`, and the phase-1
 * `buildArgs` argv builder (design §7, §2).
 *
 * The phase-1 `Slot_Config` shape is:
 *
 *     {
 *       modelPath:   string,
 *       mmprojPath:  string | null,
 *       port:        number,
 *       purpose:     'primary' | 'secondary' | 'vision' | 'embedding' | 'coding',
 *       advancedArgs: AdvancedArgs,
 *     }
 *
 * Phase-2 adds exactly one field (design §7 "Extended `Slot_Config`"):
 *
 *     visibleDevices: number[]   // non-negative integer GPU indices; default []
 *
 * `visibleDevices` lives on the Slot_Config (not on Advanced_Args) because
 * GPU pinning is a per-spawn environment concern, not an argv concern.
 *
 * Coverage goals (Task 2.5 sub-bullet):
 *   - Empty-array case (Req 5.3 / P44): no `CUDA_VISIBLE_DEVICES` mutation.
 *   - Single-element valid-range case.
 *   - Multi-element valid-range case, including duplicates and unsorted values
 *     (exercises the `Array.from(new Set(v)).sort((a,b) => a-b)` rule — P43).
 *   - Values bounded to `[0, gpuCount - 1]` when a `gpuCount` is supplied so
 *     `validateSlotConfig` accepts the generated slot.
 *
 * The helper composes additively on top of a self-contained phase-1
 * `AdvancedArgs` generator (matching `validateAdvancedArgs`'s accept set,
 * including the phase-2 memory keys from Task 2.1) rather than importing
 * from `../../advanced-args`. Keeping the helper free of production imports
 * lets property tests cross-check generator output against oracle logic
 * even when the module under test is mid-refactor.
 *
 * Supports: P43, P44.
 *
 * @module tests/helpers/arb-slot-config-extended
 */

'use strict';

const fc = require('fast-check');

/** Slot purposes recognised by phase-1 `buildArgs` (design §2). */
const SLOT_PURPOSES = Object.freeze([
  'primary',
  'secondary',
  'vision',
  'embedding',
  'coding',
]);

/** The seven KV cache types from `KV_PRECISION_BYTES` (design §1). */
const KV_CACHE_TYPES = Object.freeze([
  'f32',
  'f16',
  'q8_0',
  'q5_1',
  'q5_0',
  'q4_1',
  'q4_0',
]);

/**
 * Phase-1 slot-port range. The phase-1 `SlotManager` assigns five fixed
 * ports 13434–13438; generators widen that to `[13434, 13500]` so the
 * argv builder's `--port` insertion is exercised on a variety of values
 * without drifting into privileged / reserved territory.
 */
const arbPort = fc.integer({ min: 13434, max: 13500 });

/**
 * Gaussian-ish path generator: produces POSIX-style absolute paths with
 * a `.gguf` extension. The argv builder treats these as opaque strings,
 * so the only constraint is that they are non-empty.
 */
const arbModelPath = fc
  .string({ minLength: 1, maxLength: 32 })
  // Strip path separators / quotes so the generated string can be used
  // in shell-argv inspection without escaping surprises.
  .filter((s) => !/[\s/\\"'`]/u.test(s))
  .map((name) => `/models/${name}.gguf`);

/**
 * Optional `mmprojPath`: 50/50 split between `null` (phase-1 default) and
 * a `.gguf` sidecar path.
 */
const arbMmprojPath = fc.option(
  fc
    .string({ minLength: 1, maxLength: 32 })
    .filter((s) => !/[\s/\\"'`]/u.test(s))
    .map((name) => `/models/${name}.mmproj.gguf`),
  { freq: 2, nil: null },
);

/**
 * Phase-1 sampling params arbitrary. Ranges mirror `validateAdvancedArgs`
 * (phase-1 requirements 11–13) so every draw passes validation.
 */
const arbSampling = fc.record({
  temp: fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
  topK: fc.integer({ min: 0, max: 1000 }),
  topP: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  repeatPenalty: fc.double({
    min: 0,
    max: 2,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  presencePenalty: fc.double({
    min: -2,
    max: 2,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  frequencyPenalty: fc.double({
    min: -2,
    max: 2,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  seed: fc.integer({ min: -1, max: 2147483647 }),
});

/**
 * Phase-1 speculative-decoding config arbitrary.
 *
 * Always produces `{ enabled: false, draftModel: null, draftCtxSize: ... }`.
 *
 * Rationale: the phase-1 `validateAdvancedArgs` performs an `fs.existsSync`
 * check on `speculative.draftModel` whenever `enabled === true`, and that
 * check is unsatisfiable from a property test without real files on disk.
 * The properties this helper supports (P43, P44 — `CUDA_VISIBLE_DEVICES`
 * formatting and omission) don't exercise speculative decoding at all, so
 * pinning `enabled` to `false` keeps every generated slot-config accepted
 * by the real validator while leaving the speculative-enabled branch for
 * dedicated phase-1 speculative tests.
 */
const arbSpeculative = fc.record({
  enabled: fc.constant(false),
  draftModel: fc.constant(null),
  draftCtxSize: fc.integer({ min: 512, max: 8192 }),
});

/**
 * Phase-1 + phase-2 `AdvancedArgs` arbitrary.
 *
 * Every numeric range, set membership, and boolean combination is chosen
 * so the generated object passes the extended `validateAdvancedArgs`.
 * `ubatchSize <= batchSize` is enforced via a post-map clamp (Req 9.5).
 */
const arbAdvancedArgsExtended = fc
  .record({
    flashAttn: fc.boolean(),
    mmap: fc.boolean(),
    mlock: fc.boolean(),
    ctxSize: fc.integer({ min: 512, max: 32768 }),
    batchSize: fc.integer({ min: 32, max: 4096 }),
    ubatchSize: fc.integer({ min: 32, max: 4096 }),
    parallel: fc.integer({ min: 1, max: 16 }),
    tensorSplit: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 4 }),
    mainGpu: fc.integer({ min: 0, max: 8 }),
    splitMode: fc.constantFrom('none', 'layer', 'row'),
    rpc: fc.array(
      fc
        .tuple(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[\s:,]/u.test(s)),
          fc.integer({ min: 1024, max: 65535 }),
        )
        .map(([host, p]) => `${host}:${p}`),
      { maxLength: 4 },
    ),
    contBatching: fc.boolean(),
    sampling: arbSampling,
    speculative: arbSpeculative,
    // ----- Phase-2 memory-tuning fields (Task 2.1 ranges) -----
    nGpuLayers: fc.integer({ min: -1, max: 999 }),
    typeK: fc.constantFrom(...KV_CACHE_TYPES),
    typeV: fc.constantFrom(...KV_CACHE_TYPES),
    nCpuMoe: fc.integer({ min: 0, max: 999 }),
    threads: fc.integer({ min: 1, max: 256 }),
  })
  .map((a) => ({
    ...a,
    // Enforce the phase-1 invariant ubatchSize <= batchSize (Req 9.5).
    ubatchSize: Math.min(a.ubatchSize, a.batchSize),
  }));

/**
 * Arbitrary for a `visibleDevices` array bounded to `[0, gpuCount - 1]`.
 *
 * Distribution is weighted so every branch of the env-construction logic
 * (design §7, Req 5.2/5.3) is hit within a default 100-run campaign:
 *
 *   - weight 3 : empty array                — Req 5.3 / P44 branch.
 *   - weight 3 : single-element array       — simplest non-empty case.
 *   - weight 3 : multi-element array with   — exercises dedup + sort
 *                possible duplicates and      rule in `_buildChildEnv`
 *                arbitrary order              and the matching P43
 *                                             oracle.
 *
 * When `gpuCount <= 0` only the empty-array branch is reachable (there
 * are no valid indices to draw). Callers pass `gpuCount = 0` to force the
 * detection-failure / zero-GPU path used by P44 and Req 5.5.
 *
 * @param {number} gpuCount - upper bound (exclusive) for indices. Non-negative.
 * @returns {fc.Arbitrary<number[]>}
 */
function arbVisibleDevices(gpuCount) {
  if (!Number.isInteger(gpuCount) || gpuCount < 0) {
    throw new TypeError(
      `arbVisibleDevices: gpuCount must be a non-negative integer, received ${gpuCount}`,
    );
  }
  if (gpuCount === 0) {
    // No legal non-empty array exists — only the empty-array case is reachable.
    return fc.constant([]);
  }
  const maxIdx = gpuCount - 1;
  const arbIdx = fc.integer({ min: 0, max: maxIdx });
  return fc.oneof(
    { weight: 3, arbitrary: fc.constant([]) },
    {
      weight: 3,
      arbitrary: arbIdx.map((i) => [i]),
    },
    {
      weight: 3,
      // Allow duplicates and arbitrary order — the `_buildChildEnv` contract
      // is responsible for dedup + ascending sort (Req 5.2, P43).
      arbitrary: fc.array(arbIdx, { minLength: 1, maxLength: gpuCount * 2 }),
    },
  );
}

/**
 * Convenience arbitrary: always `[]`. Used by P44 (omission) tests where
 * `visibleDevices` must never be populated.
 */
const arbVisibleDevicesEmpty = fc.constant([]);

/**
 * Arbitrary GPU count for property tests that want to vary the environment
 * bound along with the slot-config. Covers:
 *   - 0 GPUs    (detection failure / Req 5.5 disabled-control branch)
 *   - 1 GPU     (UI hides the control; `visibleDevices` still allowed)
 *   - 2–8 GPUs  (multi-GPU branch)
 */
const arbGpuCount = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.constant(1) },
  { weight: 3, arbitrary: fc.integer({ min: 2, max: 8 }) },
);

/**
 * Extended `Slot_Config` arbitrary.
 *
 * Composes a fresh phase-1 slot-config body with a `visibleDevices` array
 * bounded to `[0, gpuCount - 1]`. When `gpuCount` is omitted, the draw is
 * chained through `arbGpuCount` so the caller can inspect both the
 * generated `slotConfig` and the matching `gpuCount` via the returned
 * wrapper.
 *
 * Two forms are offered:
 *
 *   - `arbSlotConfigExtended(opts)` returns just the slot-config, with
 *     `opts.gpuCount` fixing the bound used for `visibleDevices`.
 *   - `arbSlotConfigExtendedWithGpuCount()` returns `{ slotConfig, gpuCount }`
 *     so property tests that need the matching `budget.gpuCount` (e.g.
 *     P43 with `validateSlotConfig`, where the upper-bound check is
 *     `< budget.gpuCount`) can forward both halves.
 *
 * @param {{ gpuCount?: number }} [opts]
 * @returns {fc.Arbitrary<object>}
 */
function arbSlotConfigExtended(opts = {}) {
  const { gpuCount } = opts;
  const gpuCountArb =
    Number.isInteger(gpuCount) && gpuCount >= 0
      ? fc.constant(gpuCount)
      : arbGpuCount;
  return gpuCountArb.chain((count) =>
    fc.record({
      modelPath: arbModelPath,
      mmprojPath: arbMmprojPath,
      port: arbPort,
      purpose: fc.constantFrom(...SLOT_PURPOSES),
      advancedArgs: arbAdvancedArgsExtended,
      visibleDevices: arbVisibleDevices(count),
    }),
  );
}

/**
 * Returns `{ slotConfig, gpuCount }` tuples so property tests can assert
 * `validateSlotConfig(slotConfig, { detected: true, gpuCount, ... })`
 * without having to reconstruct the bound used when the array was drawn.
 *
 * @returns {fc.Arbitrary<{ slotConfig: object, gpuCount: number }>}
 */
function arbSlotConfigExtendedWithGpuCount() {
  return arbGpuCount.chain((gpuCount) =>
    fc
      .record({
        modelPath: arbModelPath,
        mmprojPath: arbMmprojPath,
        port: arbPort,
        purpose: fc.constantFrom(...SLOT_PURPOSES),
        advancedArgs: arbAdvancedArgsExtended,
        visibleDevices: arbVisibleDevices(gpuCount),
      })
      .map((slotConfig) => ({ slotConfig, gpuCount })),
  );
}

module.exports = {
  SLOT_PURPOSES,
  KV_CACHE_TYPES,
  arbPort,
  arbModelPath,
  arbMmprojPath,
  arbSampling,
  arbSpeculative,
  arbAdvancedArgsExtended,
  arbVisibleDevices,
  arbVisibleDevicesEmpty,
  arbGpuCount,
  arbSlotConfigExtended,
  arbSlotConfigExtendedWithGpuCount,
};
