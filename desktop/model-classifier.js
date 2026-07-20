/**
 * @fileoverview Pure model classifier helpers for the llama-cpp-memory-tuning spec.
 *
 * Exposes:
 *  - `MOE_ARCHITECTURES`       : set of lower-case GGUF `general.architecture`
 *                                values that imply Mixture-of-Experts
 *  - `MOE_FILENAME_RE`         : case-insensitive filename regex used when
 *                                architecture metadata is absent
 *  - `PARAM_COUNT_RE`          : regex that extracts the `<N>B` parameter-count
 *                                tag from a GGUF filename
 *  - `detectMoE(modelMeta)`    : total function returning whether the model is
 *                                MoE (Req 3.5, P41)
 *  - `inferTotalParamsB(m)`    : metadata → filename → size-bytes fallback for
 *                                the total parameter count in billions (Req 8.4)
 *  - `inferTotalLayers(m)`     : metadata → size-based heuristic for n_layer
 *  - `classifyModel(modelMeta)`: returns one of
 *                                'dense-small' | 'dense-large' |
 *                                'moe-small'   | 'moe-large'   (Req 8)
 *
 * This module is pure: no I/O, no process spawns, no network calls, no clock
 * reads, no `process.env` reads. All exports are deterministic total functions
 * on their documented input domains.
 */

'use strict';

/**
 * @typedef {Object} ModelMeta
 * @property {string} [filename]        Basename of the GGUF file.
 * @property {number} [sizeBytes]       `stat().size` of the GGUF file.
 * @property {string} [architecture]    GGUF `general.architecture` value.
 * @property {boolean} [isMoE]          Explicit MoE flag from metadata.
 * @property {number} [activeParamsB]   Active params in billions (MoE only).
 * @property {number} [totalParamsB]    Total params in billions.
 * @property {number} [totalLayers]     Transformer layer count (`n_layer`).
 */

/**
 * GGUF `general.architecture` values that unambiguously indicate a
 * Mixture-of-Experts model. Values are lower-cased before comparison.
 * Sourced from design §3.
 *
 * @type {ReadonlySet<string>}
 */
const MOE_ARCHITECTURES = Object.freeze(new Set([
  'qwen2_moe',
  'mixtral',
  'deepseek2',
  'dbrx',
  'jamba',
  'phimoe',
  'granitemoe',
]));

/**
 * Case-insensitive filename heuristic for MoE detection when architecture
 * metadata is missing. Matches common naming conventions: a `moe` token, an
 * `A<N>B` active-params tag (e.g., `A2.7B`), or known MoE model families.
 *
 * @type {RegExp}
 */
const MOE_FILENAME_RE = /\b(moe|a\d+b|mixtral|deepseek-?v?\d|qwen.*(moe|a\d+b)|dbrx)\b/i;

/**
 * Regex that extracts a `<N>B` parameter-count tag surrounded by `_` or `-`
 * (or end-of-string) from a GGUF filename. `N` may contain a decimal part.
 * Example matches: `llama-2-7b-...`, `Qwen1.5-MoE-A2.7B-...`.
 *
 * @type {RegExp}
 */
const PARAM_COUNT_RE = /[_\-](\d+(?:\.\d+)?)[bB](?:[_\-]|$)/;

/** Internal constant: 8 GiB in bytes, used as the size-fallback split. */
const EIGHT_GIB_BYTES = 8 * 1024 * 1024 * 1024;

/** Internal constant: dense small/large split in billions of params. */
const DENSE_SMALL_MAX_B = 13;

/** Internal constant: MoE small/large split in billions of params. */
const MOE_SMALL_MAX_B = 30;

/**
 * Returns true iff the given object describes a Mixture-of-Experts model.
 *
 * Decision order (first match wins):
 *   1. Explicit boolean `modelMeta.isMoE`.
 *   2. Lower-cased `modelMeta.architecture` is a member of `MOE_ARCHITECTURES`.
 *   3. `MOE_FILENAME_RE` matches `modelMeta.filename`.
 *
 * Total function: returns `false` for `null`, `undefined`, and any non-object
 * input without throwing.
 *
 * Validates: Requirements 3.5 (P41).
 *
 * @param {ModelMeta|unknown} modelMeta
 * @returns {boolean}
 */
function detectMoE(modelMeta) {
  if (modelMeta === null || typeof modelMeta !== 'object') {
    return false;
  }

  // Honour explicit boolean override from GGUF metadata.
  if (typeof modelMeta.isMoE === 'boolean') {
    return modelMeta.isMoE;
  }

  // Architecture lookup (case-insensitive).
  if (typeof modelMeta.architecture === 'string' && modelMeta.architecture.length > 0) {
    if (MOE_ARCHITECTURES.has(modelMeta.architecture.toLowerCase())) {
      return true;
    }
  }

  // Filename regex fallback.
  if (typeof modelMeta.filename === 'string' && modelMeta.filename.length > 0) {
    return MOE_FILENAME_RE.test(modelMeta.filename);
  }

  return false;
}

/**
 * Infers the total parameter count in billions from `modelMeta`.
 *
 * Decision order (first success wins):
 *   1. `modelMeta.totalParamsB` when it is a finite positive number.
 *   2. `PARAM_COUNT_RE` match on `modelMeta.filename`.
 *   3. Size-bytes fallback: `sizeBytes < 8 GiB → 7`, otherwise `14`.
 *
 * Always returns a finite positive number so downstream consumers
 * (`classifyModel`, `recommendPreset`) never need to guard against `NaN` or
 * `undefined`.
 *
 * Validates: Requirements 8.4.
 *
 * @param {ModelMeta|unknown} modelMeta
 * @returns {number}
 */
function inferTotalParamsB(modelMeta) {
  const meta = (modelMeta !== null && typeof modelMeta === 'object') ? modelMeta : {};

  // 1. Honour metadata when it is a finite positive number.
  if (typeof meta.totalParamsB === 'number'
      && Number.isFinite(meta.totalParamsB)
      && meta.totalParamsB > 0) {
    return meta.totalParamsB;
  }

  // 2. Filename regex match.
  if (typeof meta.filename === 'string' && meta.filename.length > 0) {
    const match = PARAM_COUNT_RE.exec(meta.filename);
    if (match !== null) {
      const parsed = Number.parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  // 3. Size-bytes fallback.
  const sizeBytes = (typeof meta.sizeBytes === 'number' && Number.isFinite(meta.sizeBytes))
    ? meta.sizeBytes
    : 0;
  return sizeBytes < EIGHT_GIB_BYTES ? 7 : 14;
}

/**
 * Infers the number of transformer layers (`n_layer`) from `modelMeta`.
 *
 * Decision order:
 *   1. `modelMeta.totalLayers` when it is a positive integer.
 *   2. Heuristic table keyed on the inferred total parameter count, sourced
 *      from design §3.
 *
 * Always returns a positive integer.
 *
 * @param {ModelMeta|unknown} modelMeta
 * @returns {number}
 */
function inferTotalLayers(modelMeta) {
  const meta = (modelMeta !== null && typeof modelMeta === 'object') ? modelMeta : {};

  if (Number.isInteger(meta.totalLayers) && meta.totalLayers > 0) {
    return meta.totalLayers;
  }

  const pb = inferTotalParamsB(meta);
  if (pb <= 3) return 26;
  if (pb <= 8) return 32;
  if (pb <= 13) return 40;
  if (pb <= 35) return 48;
  if (pb <= 70) return 80;
  return 96;
}

/**
 * Classifies `modelMeta` into one of four classes:
 *   - `'moe-small'`   — MoE with total params ≤ 30 B
 *   - `'moe-large'`   — MoE with total params > 30 B
 *   - `'dense-small'` — dense with total params ≤ 13 B
 *   - `'dense-large'` — dense with total params > 13 B
 *
 * Pure, deterministic, total function. Performs no I/O, no process spawns,
 * and no network calls.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 (P58, P59, P60).
 *
 * @param {ModelMeta|unknown} modelMeta
 * @returns {'dense-small'|'dense-large'|'moe-small'|'moe-large'}
 */
function classifyModel(modelMeta) {
  const isMoE = detectMoE(modelMeta);
  const totalB = inferTotalParamsB(modelMeta);

  if (isMoE) {
    return totalB <= MOE_SMALL_MAX_B ? 'moe-small' : 'moe-large';
  }
  return totalB <= DENSE_SMALL_MAX_B ? 'dense-small' : 'dense-large';
}

module.exports = {
  MOE_ARCHITECTURES,
  MOE_FILENAME_RE,
  PARAM_COUNT_RE,
  detectMoE,
  inferTotalParamsB,
  inferTotalLayers,
  classifyModel,
};
