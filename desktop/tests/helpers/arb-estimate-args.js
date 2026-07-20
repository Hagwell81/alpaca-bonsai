/* eslint-env node */
/**
 * fast-check arbitrary for the extended `EstimateInput` shape consumed by
 * the refined `VramBudgetManager.estimateRequiredMB` (design §6.1).
 *
 * Input shape produced:
 * {
 *   modelFileSizeMB,   // finite >= 0
 *   totalLayers,       // positive integer
 *   ctxSize,           // positive integer
 *   typeK,             // one of the seven KV cache types
 *   typeV,             // one of the seven KV cache types
 *   purpose,           // 'primary' | 'secondary' | 'vision' | 'embedding' | 'coding'
 *   nGpuLayers,        // -1 sentinel OR integer in [0, 999]
 *   nCpuMoe,           // integer in [0, 999]
 *   isMoE,             // boolean
 *   activeParamsB?,    // present only when isMoE is true
 *   totalParamsB?,     // present only when isMoE is true
 *   hiddenSizeBytesPerTokenPerLayer?, // optional GGUF-derived override
 *   mmprojMB?,         // optional explicit mmproj override
 * }
 *
 * Coverage goals (Task 2.4):
 * - Both MoE-on (`isMoE: true` with `activeParamsB` / `totalParamsB`) and
 *   MoE-off (`isMoE: false`) branches.
 * - All `nGpuLayers` sentinels: the `-1` "let llama-server decide" sentinel,
 *   `0` (no offload), `totalLayers` (full offload), and arbitrary positive
 *   integers in between (including values that exceed `totalLayers`, to
 *   exercise the `min(nGpuLayers, totalLayers)` clamp).
 * - Full KV type spread across both `typeK` and `typeV`: every combination
 *   of the seven-value set `{f32, f16, q8_0, q5_1, q5_0, q4_1, q4_0}` is
 *   reachable.
 *
 * The arbitrary does not import from `../../advanced-args` or
 * `../../vram-budget-manager`: helpers must be self-contained so that the
 * tests can compare generator output against oracle implementations even
 * when the production module under test is mid-refactor.
 *
 * @module tests/helpers/arb-estimate-args
 */

const fc = require('fast-check');

/**
 * The seven KV cache types from `KV_PRECISION_BYTES` (design §1).
 *
 * Kept as a frozen array so every call site shares the same reference and
 * cannot accidentally mutate the list.
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

/**
 * Slot_Purpose values recognised by phase-1 `estimateRequiredMB`.
 *
 * `'vision'` is included so generators exercise the mmproj-overhead branch.
 *
 * @type {ReadonlyArray<'primary'|'secondary'|'vision'|'embedding'|'coding'>}
 */
const SLOT_PURPOSES = Object.freeze([
  'primary',
  'secondary',
  'vision',
  'embedding',
  'coding',
]);

/**
 * Arbitrary for a single KV cache type, uniformly sampled from the
 * seven-value set. `typeK` and `typeV` are drawn independently so every
 * 7 * 7 combination (including matched pairs like `f16/f16` and asymmetric
 * pairs like `q4_0/f16`) is reachable.
 */
const arbKvCacheType = fc.constantFrom(...KV_CACHE_TYPES);

/**
 * Arbitrary for the Slot_Purpose field.
 */
const arbPurpose = fc.constantFrom(...SLOT_PURPOSES);

/**
 * Arbitrary for `nGpuLayers` producing the full range of sentinels and
 * in-range values:
 *   - `-1`                    (server-default sentinel, design §6.1 Req 6.2)
 *   - `0`                     (no offload, Req 6.3)
 *   - `totalLayers`           (full offload, Req 6.3's max-case)
 *   - integer in `[0, 999]`   (schema-valid values, some exceeding
 *                              `totalLayers` to exercise the clamp)
 *
 * @param {number} totalLayers - positive integer to bias the distribution around.
 */
function arbNgpuLayers(totalLayers) {
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(-1) },
    { weight: 2, arbitrary: fc.constant(0) },
    { weight: 2, arbitrary: fc.constant(totalLayers) },
    { weight: 3, arbitrary: fc.integer({ min: 0, max: Math.max(0, totalLayers - 1) }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 999 }) },
  );
}

/**
 * Core arbitrary for the extended `EstimateInput`.
 *
 * Generates both MoE-on and MoE-off variants with equal probability. When
 * `isMoE` is true, `activeParamsB` and `totalParamsB` are always present
 * and satisfy `totalParamsB > activeParamsB > 0` so that the MoE
 * inactive-expert subtraction branch is actually exercised. When
 * `isMoE` is false, neither field is present (the estimator must not
 * depend on them in that case — Req 6.9, P49).
 *
 * All numeric fields are clamped to ranges that keep downstream arithmetic
 * well within IEEE-754 precision while still hitting realistic production
 * workloads (large MoE models up to ~128 total params B, ctx up to 32K,
 * model files up to 256 GiB).
 *
 * Optional fields (`hiddenSizeBytesPerTokenPerLayer`, `mmprojMB`) are
 * present ~50% of the time so generators exercise both the default and
 * override branches of the formula.
 */
const arbEstimateInput = fc
  .record({
    modelFileSizeMB: fc.double({
      min: 0,
      max: 262144,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    totalLayers: fc.integer({ min: 1, max: 120 }),
    ctxSize: fc.integer({ min: 512, max: 32768 }),
    typeK: arbKvCacheType,
    typeV: arbKvCacheType,
    purpose: arbPurpose,
    nCpuMoe: fc.integer({ min: 0, max: 999 }),
    isMoE: fc.boolean(),
    // Optional GGUF-derived override — 50/50 present vs. absent.
    hiddenSizeBytesPerTokenPerLayerOpt: fc.option(
      fc.integer({ min: 64, max: 4096 }),
      { freq: 2, nil: undefined },
    ),
    // Optional explicit mmproj override — 50/50 present vs. absent.
    mmprojMBOpt: fc.option(
      fc.integer({ min: 0, max: 4096 }),
      { freq: 2, nil: undefined },
    ),
    // Raw MoE param draws; only attached when `isMoE` is true.
    totalParamsBRaw: fc.double({
      min: 1,
      max: 128,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    activeFraction: fc.double({
      min: 0.05,
      max: 0.95,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  })
  .chain((draft) =>
    arbNgpuLayers(draft.totalLayers).map((nGpuLayers) => {
      const out = {
        modelFileSizeMB: draft.modelFileSizeMB,
        totalLayers: draft.totalLayers,
        ctxSize: draft.ctxSize,
        typeK: draft.typeK,
        typeV: draft.typeV,
        purpose: draft.purpose,
        nGpuLayers,
        nCpuMoe: draft.nCpuMoe,
        isMoE: draft.isMoE,
      };
      if (draft.isMoE) {
        // Design §6.2: `estimateInactiveExpertMB` expects
        // `totalParamsB > activeParamsB > 0`.
        const totalParamsB = draft.totalParamsBRaw;
        const activeParamsB = Math.max(
          Number.EPSILON,
          totalParamsB * draft.activeFraction,
        );
        out.activeParamsB = activeParamsB;
        out.totalParamsB = totalParamsB;
      }
      if (draft.hiddenSizeBytesPerTokenPerLayerOpt !== undefined) {
        out.hiddenSizeBytesPerTokenPerLayer =
          draft.hiddenSizeBytesPerTokenPerLayerOpt;
      }
      if (draft.mmprojMBOpt !== undefined) {
        out.mmprojMB = draft.mmprojMBOpt;
      }
      return out;
    }),
  );

/**
 * Default export used directly by the property tests.
 *
 * @returns {fc.Arbitrary<object>}
 */
function arbEstimateArgs() {
  return arbEstimateInput;
}

/**
 * Convenience factory that forces `isMoE: false`. Used by P49 (MoE
 * irrelevance for dense models) which must vary `nCpuMoe` while holding
 * every other field fixed.
 */
function arbEstimateArgsDense() {
  return arbEstimateInput.map((a) => {
    if (!a.isMoE) return a;
    // Strip MoE-only fields to keep the dense invariant explicit.
    const { activeParamsB: _aB, totalParamsB: _tB, ...rest } = a;
    return { ...rest, isMoE: false };
  });
}

/**
 * Convenience factory that forces `isMoE: true` and guarantees both
 * `activeParamsB` and `totalParamsB` are present. Used by P48 (MoE
 * subtraction anti-monotonicity) to avoid wasting runs on dense draws.
 */
function arbEstimateArgsMoe() {
  return arbEstimateInput
    .filter((a) => a.isMoE)
    .map((a) => a);
}

module.exports = {
  KV_CACHE_TYPES,
  SLOT_PURPOSES,
  arbKvCacheType,
  arbPurpose,
  arbNgpuLayers,
  arbEstimateArgs,
  arbEstimateArgsDense,
  arbEstimateArgsMoe,
};
