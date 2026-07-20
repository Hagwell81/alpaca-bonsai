/* eslint-env node */
/**
 * fast-check arbitraries for the `ModelMeta` shape consumed by the pure
 * helpers in `model-classifier.js` (design §3).
 *
 * `ModelMeta` shape (design §3 "Data Models"):
 *
 *     {
 *       filename?:       string,   // basename of the GGUF file
 *       sizeBytes?:      number,   // stat().size
 *       architecture?:   string,   // GGUF general.architecture
 *       isMoE?:          boolean,  // explicit MoE override
 *       activeParamsB?:  number,   // active params in billions (MoE only)
 *       totalParamsB?:   number,   // total params in billions
 *       totalLayers?:    number,   // transformer layer count (n_layer)
 *       hiddenSizeBytesPerTokenPerLayer?: number, // GGUF-derived override
 *     }
 *
 * Three generator shapes are exposed, per task 2.2 sub-bullet:
 *
 *   1. `arbModelMetaFullGguf`     — every field present, with internally
 *                                   consistent MoE/dense tagging (architecture
 *                                   and filename align with the `isMoE` flag).
 *   2. `arbModelMetaFilenameOnly` — only `filename` (and sometimes `sizeBytes`)
 *                                   populated; forces the classifier into its
 *                                   filename-regex / size-fallback branches.
 *   3. `arbModelMetaMoeOverride`  — `isMoE: true` is set explicitly; the two
 *                                   MoE-only fields (`activeParamsB`,
 *                                   `totalParamsB`) are present ~50% of the
 *                                   time so the estimator's MoE-subtraction
 *                                   branch is exercised both with and without
 *                                   the metadata hint.
 *
 * The unified `arbModelMeta` picks among the three with weighting chosen so
 * that every branch of `detectMoE` / `classifyModel` is reached within a
 * 100-run fast-check campaign.
 *
 * Supports: P41 (detectMoE oracle), P58–P60 (classifyModel properties),
 *           P61–P63 (recommendPreset properties).
 *
 * The helper does NOT import from `../../model-classifier`: helpers must be
 * self-contained so that property tests can cross-check generator output
 * against oracle implementations even when the production module under test
 * is mid-refactor.
 *
 * @module tests/helpers/arb-model-meta
 */

'use strict';

const fc = require('fast-check');

/**
 * GGUF `general.architecture` values that imply MoE. Kept in lock-step with
 * `MOE_ARCHITECTURES` in `model-classifier.js` (design §3).
 *
 * @type {ReadonlyArray<string>}
 */
const MOE_ARCHITECTURES_LIST = Object.freeze([
  'qwen2_moe',
  'mixtral',
  'deepseek2',
  'dbrx',
  'jamba',
  'phimoe',
  'granitemoe',
]);

/**
 * Common dense architectures. None of these are members of
 * `MOE_ARCHITECTURES`, nor do their names embed a substring that would
 * accidentally match `MOE_FILENAME_RE`.
 *
 * @type {ReadonlyArray<string>}
 */
const DENSE_ARCHITECTURES_LIST = Object.freeze([
  'llama',
  'qwen2',
  'mistral',
  'phi3',
  'gemma',
  'gemma2',
  'stablelm',
  'starcoder2',
  'falcon',
  'command-r',
]);

/**
 * Canonical GGUF filenames that are recognised as MoE by
 * `MOE_FILENAME_RE` (either via the `moe` token, an `A<N>B` active-params
 * tag, or a known family name such as `mixtral` / `deepseek` / `dbrx`).
 *
 * Every entry is a real-world filename pattern observed in the wild; they
 * double as human-readable regression fixtures.
 *
 * @type {ReadonlyArray<string>}
 */
const MOE_FILENAMES = Object.freeze([
  'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
  'Mixtral-8x22B-Instruct-v0.1.Q5_K_M.gguf',
  'Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf',
  'Qwen2-57B-A14B-Instruct.Q4_K_M.gguf',
  'deepseek-v2-chat.Q4_K_M.gguf',
  'deepseek-v2-lite-chat.Q5_K_M.gguf',
  'dbrx-instruct.Q4_K_M.gguf',
  'jamba-1.5-mini-MoE.Q4_K_M.gguf',
  'Phi-MoE-mini-instruct.Q4_K_M.gguf',
  'granite-3.0-moe-3b-a800m-instruct.Q4_K_M.gguf',
]);

/**
 * Canonical dense-model filenames. Manually audited so that none match
 * `MOE_FILENAME_RE`: no `moe`/`A<N>B` tokens, no `mixtral`/`dbrx` strings,
 * no `deepseek-?v?\d` prefix, no `qwen.*moe|qwen.*a\d+b` substring.
 *
 * @type {ReadonlyArray<string>}
 */
const DENSE_FILENAMES = Object.freeze([
  'llama-2-7b-q4_K_M.gguf',
  'llama-2-13b-chat.Q4_K_M.gguf',
  'llama-3-70b-instruct.Q4_K_M.gguf',
  'mistral-7b-instruct-v0.2.Q4_K_M.gguf',
  'phi-3-mini-4k-instruct.Q4_K_M.gguf',
  'gemma-2-9b-it.Q4_K_M.gguf',
  'qwen2-7b-instruct.Q4_K_M.gguf',
  'starcoder2-15b.Q4_K_M.gguf',
  'codellama-34b-instruct.Q4_K_M.gguf',
  'falcon-40b-instruct.Q5_K_M.gguf',
]);

/** 8 GiB expressed in bytes (the estimator's size-fallback split). */
const EIGHT_GIB_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * Realistic GGUF file-size range: 512 MiB to 256 GiB. Spans everything from
 * a small 1B Q4 model to a large MoE at Q8.
 */
const arbSizeBytes = fc.integer({
  min: 512 * 1024 * 1024,
  max: 256 * 1024 * 1024 * 1024,
});

/**
 * Positive integer in the production-plausible transformer-layer range.
 * The lower bound is 1 (so inferTotalLayers' denominator is never zero
 * when a caller trusts this field); the upper bound is 120 (beyond the
 * largest published open model at time of writing).
 */
const arbTotalLayers = fc.integer({ min: 1, max: 120 });

/**
 * Arbitrary for `hiddenSizeBytesPerTokenPerLayer`. The classifier does not
 * consume this field, but the estimator does; generators should produce
 * realistic positive integers so downstream PBT tests using the same
 * `ModelMeta` can reuse this arb without post-processing.
 */
const arbHiddenSizeBytesPerTokenPerLayer = fc.integer({ min: 64, max: 4096 });

/** MoE architecture constant, uniformly sampled from `MOE_ARCHITECTURES_LIST`. */
const arbMoeArchitecture = fc.constantFrom(...MOE_ARCHITECTURES_LIST);

/** Dense architecture constant, uniformly sampled from `DENSE_ARCHITECTURES_LIST`. */
const arbDenseArchitecture = fc.constantFrom(...DENSE_ARCHITECTURES_LIST);

/** MoE-matching filename, uniformly sampled from `MOE_FILENAMES`. */
const arbMoeFilename = fc.constantFrom(...MOE_FILENAMES);

/** Dense filename, uniformly sampled from `DENSE_FILENAMES`. */
const arbDenseFilename = fc.constantFrom(...DENSE_FILENAMES);

/** Filename from either pool; used where the MoE-vs-dense split is irrelevant. */
const arbAnyFilename = fc.oneof(arbMoeFilename, arbDenseFilename);

/**
 * Generates `{ totalParamsB, activeParamsB }` with the invariant
 * `totalParamsB > activeParamsB > 0`. The ratio is drawn uniformly in
 * `[0.05, 0.95]` so generators cover both dense-ish MoE (e.g. Qwen2-57B
 * with 14B active, ratio ≈ 0.245) and sparse MoE (e.g. Mixtral-8x7B with
 * ~13B active, ratio ≈ 0.28).
 */
const arbMoeParamsPair = fc
  .record({
    totalParamsB: fc.double({
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
  .map(({ totalParamsB, activeFraction }) => ({
    totalParamsB,
    activeParamsB: Math.max(Number.EPSILON, totalParamsB * activeFraction),
  }));

/**
 * Dense `totalParamsB` range: covers the classifier's dense-small/large
 * boundary at 13 B (design §3) with plenty of runs either side.
 */
const arbDenseTotalParamsB = fc.double({
  min: 0.5,
  max: 70,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Shape 1 — "full GGUF": every `ModelMeta` field is populated and the
 * `isMoE` flag is internally consistent with `architecture` and `filename`.
 *
 * The generator picks a class (MoE or dense) uniformly, then draws from
 * the matching pool of architectures and filenames. Both MoE and dense
 * variants produce identical field sets (with the MoE-only fields
 * `activeParamsB` / `totalParamsB` still present in the dense branch;
 * the design data model marks them optional on dense but allowing them
 * on both branches exercises the estimator's guard that MoE subtraction
 * is a no-op when `isMoE === false` — Req 6.9, P49).
 */
const arbModelMetaFullGguf = fc
  .boolean()
  .chain((isMoE) =>
    fc.record({
      filename: isMoE ? arbMoeFilename : arbDenseFilename,
      sizeBytes: arbSizeBytes,
      architecture: isMoE ? arbMoeArchitecture : arbDenseArchitecture,
      isMoE: fc.constant(isMoE),
      totalLayers: arbTotalLayers,
      hiddenSizeBytesPerTokenPerLayer: arbHiddenSizeBytesPerTokenPerLayer,
      // MoE-branch pair OR a synthesised dense pair (active === total so the
      // MoE-subtraction factor collapses to zero even if a buggy callee
      // forgets to guard on isMoE).
      moeParams: isMoE
        ? arbMoeParamsPair
        : arbDenseTotalParamsB.map((tb) => ({
          totalParamsB: tb,
          activeParamsB: tb,
        })),
    }),
  )
  .map((r) => ({
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    architecture: r.architecture,
    isMoE: r.isMoE,
    activeParamsB: r.moeParams.activeParamsB,
    totalParamsB: r.moeParams.totalParamsB,
    totalLayers: r.totalLayers,
    hiddenSizeBytesPerTokenPerLayer: r.hiddenSizeBytesPerTokenPerLayer,
  }));

/**
 * Shape 2 — "filename only": only the `filename` field is guaranteed.
 * `sizeBytes` is present ~50% of the time so the estimator's
 * size-fallback branch (`< 8 GiB → 7`, else `14`) is exercised on both
 * sides of the 8 GiB split.
 *
 * This shape forces `detectMoE` onto its `MOE_FILENAME_RE` branch (no
 * `isMoE` flag, no `architecture` hint) and forces `inferTotalParamsB`
 * onto its filename-regex or size-fallback branch (no `totalParamsB`).
 */
const arbModelMetaFilenameOnly = fc
  .record({
    filename: arbAnyFilename,
    // Option with a well-mixed split either side of the 8 GiB boundary, plus
    // the `undefined` case to test when sizeBytes is absent entirely.
    sizeBytesOpt: fc.option(
      fc.oneof(
        fc.integer({
          min: 512 * 1024 * 1024,
          max: EIGHT_GIB_BYTES - 1,
        }),
        fc.integer({
          min: EIGHT_GIB_BYTES,
          max: 256 * 1024 * 1024 * 1024,
        }),
      ),
      { freq: 2, nil: undefined },
    ),
  })
  .map((r) => {
    const out = { filename: r.filename };
    if (r.sizeBytesOpt !== undefined) {
      out.sizeBytes = r.sizeBytesOpt;
    }
    return out;
  });

/**
 * Shape 3 — "MoE override": `isMoE: true` is set explicitly (overriding
 * whatever architecture/filename would have inferred). The MoE-only
 * fields (`activeParamsB`, `totalParamsB`) are present ~50% of the time.
 *
 * Use cases:
 *   - `detectMoE` returns `true` regardless of architecture/filename
 *     (Req 3.5 — explicit override wins, P41).
 *   - `classifyModel` must return an `moe-*` value (P59).
 *   - `estimateRequiredMB` must fall back to a zero MoE subtraction when
 *     `activeParamsB`/`totalParamsB` are missing but `isMoE === true`
 *     (design §6.2, Req 6.5 tail).
 *
 * The filename and architecture are deliberately drawn from the dense
 * pools part of the time so that the override actually overrides rather
 * than coincidentally agreeing with the filename/architecture signal.
 */
const arbModelMetaMoeOverride = fc
  .record({
    // Mixing MoE and dense filenames/architectures exercises the override
    // precedence: isMoE === true must win even when every other signal
    // points to "dense".
    filename: arbAnyFilename,
    sizeBytes: arbSizeBytes,
    architecture: fc.oneof(arbMoeArchitecture, arbDenseArchitecture),
    totalLayers: arbTotalLayers,
    hiddenSizeBytesPerTokenPerLayer: arbHiddenSizeBytesPerTokenPerLayer,
    includeParams: fc.boolean(),
    moeParams: arbMoeParamsPair,
  })
  .map((r) => {
    const out = {
      filename: r.filename,
      sizeBytes: r.sizeBytes,
      architecture: r.architecture,
      isMoE: true,
      totalLayers: r.totalLayers,
      hiddenSizeBytesPerTokenPerLayer: r.hiddenSizeBytesPerTokenPerLayer,
    };
    if (r.includeParams) {
      out.activeParamsB = r.moeParams.activeParamsB;
      out.totalParamsB = r.moeParams.totalParamsB;
    }
    return out;
  });

/**
 * Unified `ModelMeta` arbitrary. Samples from the three shape-specific
 * arbitraries with weights tuned for property-test coverage:
 *
 *   - weight 3 : full GGUF         (primary shape; drives classifier +
 *                                   estimator property tests)
 *   - weight 2 : filename only     (forces classifier fallback branches)
 *   - weight 2 : MoE override      (forces explicit-override branch of
 *                                   detectMoE and MoE-missing-params
 *                                   branch of estimateInactiveExpertMB)
 */
const arbModelMeta = fc.oneof(
  { weight: 3, arbitrary: arbModelMetaFullGguf },
  { weight: 2, arbitrary: arbModelMetaFilenameOnly },
  { weight: 2, arbitrary: arbModelMetaMoeOverride },
);

module.exports = {
  MOE_ARCHITECTURES_LIST,
  DENSE_ARCHITECTURES_LIST,
  MOE_FILENAMES,
  DENSE_FILENAMES,
  arbSizeBytes,
  arbTotalLayers,
  arbHiddenSizeBytesPerTokenPerLayer,
  arbMoeArchitecture,
  arbDenseArchitecture,
  arbMoeFilename,
  arbDenseFilename,
  arbAnyFilename,
  arbMoeParamsPair,
  arbDenseTotalParamsB,
  arbModelMetaFullGguf,
  arbModelMetaFilenameOnly,
  arbModelMetaMoeOverride,
  arbModelMeta,
};
