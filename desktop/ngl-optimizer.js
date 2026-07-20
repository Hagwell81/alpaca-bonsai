/**
 * @fileoverview "Fit to VRAM" auto-tuner for the `-ngl` (nGpuLayers) Advanced_Args
 * field, plus the pure translator that feeds `estimateRequiredMB` / `canFit`.
 *
 * Exposes:
 *   - `buildEstimateInput(modelMeta, baseArgs, N)` — pure translator from an
 *     Advanced_Args-shaped object to the extended `estimateRequiredMB` input
 *     shape (design §6.1 / Req 6.1). Does not mutate `baseArgs`.
 *   - `autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB)`
 *     — returns the largest integer `N` in `[0, totalLayers]` such that
 *     `canFit({ ...args, nGpuLayers: N }, ctx).ok === true`, or the permissive
 *     fallback `totalLayers` when VRAM detection is unavailable (design §5,
 *     Reqs 7.1–7.8 / P51–P57).
 *
 * Purity contract (Req 7.6): this module performs no disk I/O, no process
 * spawns, no network requests, no `process.env` reads, and no clock reads.
 * All exported functions are deterministic total functions on their
 * documented input domains, so two successive calls with the same arguments
 * always return structurally identical results (P57).
 *
 * Validates (Requirements): 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8.
 * Property tests depending on this module: P51, P52, P53, P54, P55, P56, P57.
 */

'use strict';

const { canFit, estimateRequiredMB } = require('./vram-budget-manager');
const { detectMoE, inferTotalLayers } = require('./model-classifier');

/** Bytes per MiB — matches `vram-budget-manager.js` for dimensional parity. */
const BYTES_PER_MIB = 1024 * 1024;

/**
 * @typedef {import('./advanced-args').AdvancedArgs} AdvancedArgs
 * @typedef {import('./model-classifier').ModelMeta} ModelMeta
 */

/**
 * @typedef {Object} Budget
 * @property {boolean} detected
 * @property {number}  totalVramMB
 * @property {number}  reservedMB
 * @property {number}  [gpuCount]
 * @property {number}  [physicalCores]
 */

/**
 * Extract a finite non-negative number from `obj[key]`, or return `undefined`.
 *
 * Used so that optional MoE / hidden-size / mmproj metadata only appears on
 * the translated input when the caller actually provided a usable value, and
 * so callers passing non-numeric junk (e.g. `null`, `NaN`, `'some'`) don't
 * poison the estimate.
 *
 * @param {object|null|undefined} obj
 * @param {string} key
 * @returns {number|undefined}
 */
function pickFiniteNonNegative(obj, key) {
  if (obj === null || typeof obj !== 'object') return undefined;
  const v = obj[key];
  return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : undefined;
}

/**
 * Pure translator from `(modelMeta, baseArgs, N)` into the extended input
 * shape consumed by `estimateRequiredMB` (design §6.1 / Req 6.1).
 *
 * Fields sourced from `modelMeta`:
 *   - `modelFileSizeMB`               ← `sizeBytes / (1024 * 1024)` (0 when missing)
 *   - `totalLayers`                   ← `inferTotalLayers(modelMeta)`
 *   - `isMoE`                         ← `detectMoE(modelMeta)`
 *   - `activeParamsB`, `totalParamsB` ← metadata when finite and positive
 *   - `hiddenSizeBytesPerTokenPerLayer` ← metadata when finite and non-negative
 *
 * Fields sourced from `baseArgs` (read-only — this function does not mutate):
 *   - `ctxSize`, `typeK`, `typeV`, `nCpuMoe`, `mmprojMB`, `purpose`
 *
 * `nGpuLayers` is always the caller-supplied `N`, replacing whatever the
 * `baseArgs` held — the search driver is what varies that knob.
 *
 * No I/O, no process, no clock, no env. Calling with the same arguments
 * twice returns a structurally equal object (P57).
 *
 * @param {ModelMeta|null|undefined}  modelMeta
 * @param {AdvancedArgs|Object|null|undefined} baseArgs
 * @param {number}                    N           Candidate nGpuLayers value.
 * @returns {Object} Extended input shape for `estimateRequiredMB`.
 */
function buildEstimateInput(modelMeta, baseArgs, N) {
  const meta = (modelMeta !== null && typeof modelMeta === 'object') ? modelMeta : {};
  const args = (baseArgs !== null && typeof baseArgs === 'object') ? baseArgs : {};

  const sizeBytes = (typeof meta.sizeBytes === 'number' && Number.isFinite(meta.sizeBytes) && meta.sizeBytes > 0)
    ? meta.sizeBytes
    : 0;

  /** @type {Object} */
  const out = {
    modelFileSizeMB: sizeBytes / BYTES_PER_MIB,
    totalLayers:     inferTotalLayers(meta),
    ctxSize:         (Number.isFinite(args.ctxSize) && args.ctxSize > 0) ? args.ctxSize : 0,
    typeK:           typeof args.typeK === 'string' ? args.typeK : 'f16',
    typeV:           typeof args.typeV === 'string' ? args.typeV : 'f16',
    purpose:         typeof args.purpose === 'string' ? args.purpose : 'primary',
    nGpuLayers:      N,
    nCpuMoe:         (Number.isFinite(args.nCpuMoe) && args.nCpuMoe >= 0) ? args.nCpuMoe : 0,
    isMoE:           detectMoE(meta),
  };

  // Optional MoE param metadata — omitted unless both are finite positive
  // numbers with `total > active`, matching `estimateInactiveExpertMB`'s
  // guards. Passing them through verbatim (without the `total > active`
  // check) is deliberate: the estimator already handles the degenerate case
  // by returning 0 for `inactiveEstimateMB`.
  const activeParamsB = pickFiniteNonNegative(meta, 'activeParamsB');
  if (activeParamsB !== undefined && activeParamsB > 0) {
    out.activeParamsB = activeParamsB;
  }
  const totalParamsB = pickFiniteNonNegative(meta, 'totalParamsB');
  if (totalParamsB !== undefined && totalParamsB > 0) {
    out.totalParamsB = totalParamsB;
  }

  // Optional per-model hidden-size override (from the GGUF reader when
  // available).
  const hBytes = pickFiniteNonNegative(meta, 'hiddenSizeBytesPerTokenPerLayer');
  if (hBytes !== undefined) {
    out.hiddenSizeBytesPerTokenPerLayer = hBytes;
  }

  // Optional explicit mmproj override on the slot draft.
  const mmprojMB = pickFiniteNonNegative(args, 'mmprojMB');
  if (mmprojMB !== undefined) {
    out.mmprojMB = mmprojMB;
  }

  return out;
}

/**
 * Normalise the caller-supplied `activeAllocationsMB` into a finite,
 * non-negative number array. Non-array inputs collapse to `[]`; entries that
 * are non-finite or negative are dropped. This keeps the feasibility
 * predicate's arithmetic well-defined even if the UI passes a partial shape.
 *
 * @param {unknown} x
 * @returns {number[]}
 */
function normaliseAllocations(x) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const v of x) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out.push(v);
  }
  return out;
}

/**
 * "Fit to VRAM": find the largest `N` in `[0, totalLayers]` such that
 * `canFit({ ...baseArgs, nGpuLayers: N }, ctx).ok === true`.
 *
 * Algorithm (design §5):
 *   1. Permissive fallback: when `!budget.detected` or `budget.totalVramMB <= 0`,
 *      return `totalLayers` unchanged (Req 7.8 / P57 fallback).
 *   2. Quick rejections:
 *        - `!fits(0)` → return `0`   (Req 7.3 / P56)
 *        - `fits(totalLayers)` → return `totalLayers`  (Req 7.4 / P55)
 *   3. Binary search over `[0, totalLayers]` using `canFit` as the monotone
 *      feasibility predicate. `estimateRequiredMB` is non-decreasing in
 *      `nGpuLayers` (Req 6.7), so the set of feasible N values is a prefix
 *      `[0, k]` of `[0, totalLayers]` and the boundary is found in
 *      O(log totalLayers) `canFit` calls.
 *
 * Purity contract (Req 7.6): no I/O, no process, no network, no clock,
 * no env reads. Determinism (Req 7.5 / P57) follows directly.
 *
 * @param {ModelMeta|null|undefined} modelMeta
 * @param {AdvancedArgs|Object|null|undefined} baseArgs
 *        Advanced_Args (or slot-draft) object; read only.
 * @param {Budget} budget
 * @param {number} totalLayers   Positive integer; upper bound of the search.
 * @param {number[]} activeAllocationsMB
 *        Current per-slot VRAM allocations in MiB (phase-1 `canFit` input).
 * @returns {number} integer in `[0, totalLayers]`
 */
function autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB) {
  // --- Input coercion --------------------------------------------------------
  // `totalLayers` is nominally a positive integer. If a non-integer sneaks in
  // (e.g., from a stale UI draft), floor it to keep the search space integral.
  // Non-positive values produce a degenerate [0, 0] range so we immediately
  // fall through to the `fits(totalLayers)` shortcut with N = 0.
  const tl = Number.isFinite(totalLayers) ? Math.max(0, Math.floor(totalLayers)) : 0;
  const allocs = normaliseAllocations(activeAllocationsMB);
  const bud = (budget !== null && typeof budget === 'object') ? budget : {};

  // --- Permissive fallback (Req 7.8) -----------------------------------------
  // When VRAM detection is unavailable we cannot enforce a budget, so the
  // function returns the upper bound verbatim. Mirrors `canFit`'s
  // `!detected → { ok: true }` short-circuit: without a budget, every N is
  // feasible and the largest feasible N is `totalLayers`.
  //
  // We also apply the permissive fallback when totalVramMB <= 0, as specified
  // in Req 7.8. This treats a zero or negative budget as "no meaningful budget"
  // rather than "detected budget of 0 MB", which maintains monotonicity by
  // ensuring that all budgets <= 0 return the same value (totalLayers).
  if (bud.detected !== true
      || !Number.isFinite(bud.totalVramMB)
      || bud.totalVramMB <= 0) {
    return tl;
  }

  const reservedMB = Number.isFinite(bud.reservedMB) && bud.reservedMB >= 0
    ? bud.reservedMB
    : 0;

  /** Fixed context passed to `canFit` across the search. */
  const ctx = {
    detected: true,
    totalMB: bud.totalVramMB,
    reservedMB,
    activeAllocationsMB: allocs,
  };

  /**
   * Monotone feasibility predicate: returns `true` iff the slot with
   * `nGpuLayers = N` fits the current budget.
   *
   * @param {number} N
   * @returns {boolean}
   */
  const fits = (N) => {
    const cfg = buildEstimateInput(modelMeta, baseArgs, N);
    return canFit(cfg, ctx).ok === true;
  };

  // --- Quick rejections ------------------------------------------------------
  if (!fits(0)) return 0;                 // Req 7.3 / P56
  if (fits(tl)) return tl;                // Req 7.4 / P55

  // --- Binary search ---------------------------------------------------------
  // Loop invariant: fits(lo) === true, fits(hi) === false, lo < hi. Both
  // endpoints were established by the quick rejections above.
  let lo = 0;
  let hi = tl;
  while (hi - lo > 1) {
    const mid = lo + ((hi - lo) >> 1);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // `lo` is the largest feasible N in [0, totalLayers].
  return lo;
}

module.exports = {
  buildEstimateInput,
  autoTuneNgl,
};
