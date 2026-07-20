/* eslint-env node */
/**
 * Independent reference implementation of the refined
 * `VramBudgetManager.estimateRequiredMB` formula (design §6.1, Reqs 6.1–6.9),
 * used exclusively by P50 (per-instance overhead uniformity).
 *
 * The oracle computes the `kv + weight + mmproj` portion of the estimate —
 * everything **except** the fixed per-instance overhead. P50 asserts the
 * invariant:
 *
 *     VramBudgetManager.estimateRequiredMB(args)
 *   - oracleEstimateKvAndWeightAndMmprojMB(args)
 *   = PER_INSTANCE_OVERHEAD_MB                          // exactly 256
 *
 * for every valid `args`. The two functions are therefore required to agree
 * numerically on every shared sub-term (layers, KV cache, MoE subtraction,
 * mmproj default), and to disagree by the single `+ PER_INSTANCE_OVERHEAD_MB`
 * addition in the production path.
 *
 * Independence (per Task 2.6):
 * -----------------------------
 *   - This module MUST NOT import from `../../vram-budget-manager`. The whole
 *     point of P50 is to cross-check the production estimator against a
 *     reference that was derived directly from the design document, not from
 *     the same source tree under test. A regression that silently alters
 *     either the per-instance overhead constant OR any of the
 *     weight/kv/mmproj accounting would otherwise hide behind a shared
 *     implementation.
 *   - It **may** import the tiny `KV_PRECISION_BYTES` lookup table (via
 *     `kvPrecisionBytes`) from `../../advanced-args` because that table is a
 *     data constant called out by the specification (design §1, Req 2.4),
 *     not part of the estimator logic. Duplicating the table here would
 *     create a drift risk without adding any independence value.
 *
 * The formula below mirrors design §6.1 step-by-step; inline comments tie
 * each stanza back to the requirement or design section it encodes so that
 * future readers can audit the oracle against the spec without cross-
 * referencing the production module.
 *
 * @module tests/helpers/oracle-estimate
 */

const { kvPrecisionBytes } = require('../../advanced-args');

// -----------------------------------------------------------------------------
// Constants reproduced verbatim from design §6.1.
//
// These are deliberately duplicated rather than re-exported from the module
// under test. Tying the oracle to the design document (and not to the
// production constants) is what makes P50 a meaningful invariant: a silent
// refactor that changes, say, the mmproj default from 512 to some other value
// must either match the spec (in which case update the design AND this oracle
// together) or fail the property test loudly.
// -----------------------------------------------------------------------------

/** Bytes per MiB. Used to convert KV cache bytes into MiB. */
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Default bytes-per-token-per-layer for the hidden state (design §6.1:
 * "0.25 KiB covering typical 7B–35B models at head-dim 128 / 32 kv-heads").
 *
 * Overridable per call via `args.hiddenSizeBytesPerTokenPerLayer`.
 */
const DEFAULT_HBYTES_PER_TOKEN_PER_LAYER = 256;

/**
 * Default mmproj overhead (MiB) applied to `purpose === 'vision'` slots when
 * the caller has not supplied `args.mmprojMB`. Value preserved from phase-1
 * (design §6.1: "preserves phase-1 vision overhead").
 */
const MMPROJ_OVERHEAD_MB = 512;

// -----------------------------------------------------------------------------
// Inactive-expert MiB estimator (design §6.2, glossary "Inactive_Expert_Weight_MB").
// -----------------------------------------------------------------------------

/**
 * Oracle reference for the MoE inactive-expert weight estimate.
 *
 * Returns `0` whenever the inputs are insufficient to compute a meaningful
 * subtraction (missing / non-positive / non-finite params or file size, or
 * `totalParamsB <= activeParamsB`). This matches the conservative fallback
 * specified in design §6.2: a zero subtraction yields a larger estimate,
 * which is the safer direction for admission control.
 *
 * @param {{ modelFileSizeMB?: number, totalParamsB?: number, activeParamsB?: number }} args
 * @returns {number} non-negative MiB
 */
function oracleInactiveExpertMB(args) {
  if (!args || typeof args !== 'object') return 0;
  const { modelFileSizeMB, totalParamsB, activeParamsB } = args;

  if (!Number.isFinite(totalParamsB) || totalParamsB <= 0) return 0;
  if (!Number.isFinite(activeParamsB) || activeParamsB <= 0) return 0;
  if (totalParamsB <= activeParamsB) return 0;
  if (!Number.isFinite(modelFileSizeMB) || modelFileSizeMB <= 0) return 0;

  // bytes-per-param in the quantised on-disk file.
  const bytesPerParam = (modelFileSizeMB * BYTES_PER_MIB) / (totalParamsB * 1e9);
  const inactiveParams = (totalParamsB - activeParamsB) * 1e9;
  return (inactiveParams * bytesPerParam) / BYTES_PER_MIB;
}

// -----------------------------------------------------------------------------
// Main oracle: kv + weight + mmproj (no overhead).
// -----------------------------------------------------------------------------

/**
 * Reference implementation of the refined estimator **minus** the
 * `PER_INSTANCE_OVERHEAD_MB` contribution.
 *
 * Computes each sub-term exactly as design §6.1 specifies:
 *
 *   1. `nGpuLayers === -1` sentinel → `totalLayers` (Req 6.2).
 *   2. `layersOffloaded = max(0, min(nGplEffective, totalLayers))` (Req 6.3).
 *   3. `modelWeightContribution = modelFileSizeMB * layersOffloaded / totalLayers`
 *      (linear in `nGpuLayers`; zero when either `totalLayers` or file size is
 *      zero/missing). (Req 6.3)
 *   4. `kvPrecisionFactor = (kvPrecisionBytes(typeK) + kvPrecisionBytes(typeV)) / 4`,
 *      chosen so the `f16/f16` baseline collapses to `1.0`. (Req 6.4)
 *   5. `kvCacheBytes = ctxSize * 2 * h * layersOffloaded * kvPrecisionFactor`
 *      with `h` defaulting to `DEFAULT_HBYTES_PER_TOKEN_PER_LAYER`. (Req 6.4)
 *   6. `moeSubtractionMB = min(inactive * nCpuMoe / totalLayers,
 *      modelWeightContribution)` — clamped so the weight contribution never
 *      goes negative. Fires only when `isMoE === true` AND `nCpuMoe > 0`
 *      (Reqs 6.5, 6.9). Dense models (`isMoE !== true`) ignore `nCpuMoe`
 *      entirely — that independence is what P49 checks.
 *   7. `mmprojMB = args.mmprojMB (if finite >= 0)
 *                  else (purpose === 'vision' ? 512 : 0)`
 *      (design §6.1 "mmproj default 512 for vision").
 *   8. Return `max(0, weight - moe) + kvCacheMB + mmprojMB`.
 *
 * Note the `max(0, …)` wrapping only the weight/MoE term: `kvCacheMB` and
 * `mmprojMB` are already guaranteed non-negative by construction, and the
 * MoE subtraction is clamped to the weight contribution, so the overall
 * result is always a non-negative finite MiB figure for any validated input.
 * An outer `max(0, total)` is therefore unnecessary and is intentionally
 * omitted so the oracle's numeric shape matches the production formula
 * minus the single `+ PER_INSTANCE_OVERHEAD_MB` step.
 *
 * The oracle does **not** add `PER_INSTANCE_OVERHEAD_MB`. That is the whole
 * difference P50 measures.
 *
 * @param {object} args - Same shape consumed by `VramBudgetManager.estimateRequiredMB`.
 * @returns {number} `kv + weight + mmproj` MiB (non-negative, finite).
 */
function oracleEstimateKvAndWeightAndMmprojMB(args) {
  // Defensive normalisation mirrors the production path so phase-1-shaped
  // callers (which omit the new MoE / KV / offload fields entirely) still
  // produce a finite, non-negative oracle value. Without this, a caller
  // comparing against the production estimator for a `{}` input would see a
  // NaN-vs-256 mismatch instead of the well-defined 0-vs-256 result the
  // property intends to capture.
  if (!args || typeof args !== 'object') return 0;

  // --- Dimensional inputs ----------------------------------------------------
  const modelFileSizeMB =
    Number.isFinite(args.modelFileSizeMB) && args.modelFileSizeMB > 0
      ? args.modelFileSizeMB
      : 0;

  const totalLayers =
    Number.isFinite(args.totalLayers) && args.totalLayers > 0
      ? args.totalLayers
      : 0;

  const ctxSize =
    Number.isFinite(args.ctxSize) && args.ctxSize > 0 ? args.ctxSize : 0;

  // --- nGpuLayers sentinel handling (Req 6.2) --------------------------------
  // `-1` => "delegate to server" => full offload. A missing / non-finite
  // `nGpuLayers` falls through to the same sentinel so phase-1-shaped inputs
  // behave like the default user.
  const nGpuLayersRaw = Number.isFinite(args.nGpuLayers) ? args.nGpuLayers : -1;
  const nGplEffective = nGpuLayersRaw === -1 ? totalLayers : nGpuLayersRaw;
  const layersOffloaded = Math.max(0, Math.min(nGplEffective, totalLayers));

  // --- Model weight contribution (Req 6.3) -----------------------------------
  const modelWeightContribution =
    totalLayers > 0 && modelFileSizeMB > 0
      ? modelFileSizeMB * (layersOffloaded / totalLayers)
      : 0;

  // --- KV cache contribution (Req 6.4) ---------------------------------------
  const h =
    Number.isFinite(args.hiddenSizeBytesPerTokenPerLayer) &&
    args.hiddenSizeBytesPerTokenPerLayer >= 0
      ? args.hiddenSizeBytesPerTokenPerLayer
      : DEFAULT_HBYTES_PER_TOKEN_PER_LAYER;

  const typeK = typeof args.typeK === 'string' ? args.typeK : 'f16';
  const typeV = typeof args.typeV === 'string' ? args.typeV : 'f16';
  // `kvPrecisionBytes` is the only production symbol imported here; it is a
  // total function over the seven-value KV type set and throws
  // `UnknownKvCacheTypeError` for unknown strings. Validated inputs never
  // reach the throw branch; invalid inputs are a programmer error.
  const kvPrecisionFactor =
    (kvPrecisionBytes(typeK) + kvPrecisionBytes(typeV)) / 4;

  const kvCacheBytes = ctxSize * 2 * h * layersOffloaded * kvPrecisionFactor;
  const kvCacheMB = kvCacheBytes / BYTES_PER_MIB;

  // --- MoE inactive-expert subtraction (Reqs 6.5, 6.9) -----------------------
  // Clamped to `modelWeightContribution` so the running total cannot drop
  // below zero. Dense models (`isMoE !== true`) or slots with `nCpuMoe === 0`
  // produce a zero subtraction — that is exactly what P49 checks.
  let moeSubtractionMB = 0;
  if (
    args.isMoE === true &&
    Number.isFinite(args.nCpuMoe) &&
    args.nCpuMoe > 0 &&
    totalLayers > 0
  ) {
    const inactiveEstimateMB = oracleInactiveExpertMB(args);
    const fraction = args.nCpuMoe / totalLayers;
    moeSubtractionMB = Math.min(
      inactiveEstimateMB * fraction,
      modelWeightContribution,
    );
  }

  // --- mmproj overhead (vision default preserved from phase-1) ---------------
  const mmprojMB =
    Number.isFinite(args.mmprojMB) && args.mmprojMB >= 0
      ? args.mmprojMB
      : args.purpose === 'vision'
        ? MMPROJ_OVERHEAD_MB
        : 0;

  // --- Total (no PER_INSTANCE_OVERHEAD_MB added — that is P50's delta) -------
  return (
    Math.max(0, modelWeightContribution - moeSubtractionMB) +
    kvCacheMB +
    mmprojMB
  );
}

module.exports = {
  // Constants reproduced from design §6.1.
  BYTES_PER_MIB,
  DEFAULT_HBYTES_PER_TOKEN_PER_LAYER,
  MMPROJ_OVERHEAD_MB,
  // Oracle helpers.
  oracleInactiveExpertMB,
  oracleEstimateKvAndWeightAndMmprojMB,
};
