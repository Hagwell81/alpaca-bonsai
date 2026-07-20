/**
 * @fileoverview Advanced arguments schema, validation, and serialization for llama-server configuration.
 * Covers all Phase 1 exposed flags: performance, memory, multi-GPU, sampling, and speculative decoding.
 *
 * Phase 2 (llama-cpp-memory-tuning) adds, additively:
 *   - KV_PRECISION_BYTES table + UnknownKvCacheTypeError (Req 2.4)
 *   - kvPrecisionBytes(kvCacheType) total function (Req 2.4, P38/P39)
 *   - detectPhysicalCores(osModule) helper (Req 4.2)
 *   - MEMORY_ADVANCED_DEFAULTS and five new Advanced_Args keys merged into
 *     DEFAULT_ADVANCED_ARGS (Reqs 1.1, 2.1, 3.1, 4.1)
 *   - Extended validateAdvancedArgs checks for nGpuLayers, typeK, typeV,
 *     nCpuMoe, threads (Reqs 1.5, 2.3, 3.4, 4.4)
 *   - JSON round-trip of the five new fields via serialize/parse (Req 11.3)
 *
 * Phase 3 (mtp-turboquant-presets) adds, additively:
 *   - TurboQuant KV types: turbo2_0, turbo3_0, turbo4_0
 *   - SpeculativeConfig.mode, .nMax, .nMin, .pMin for MTP/Eagle3/ngram support
 *   - Updated validateAdvancedArgs for new speculative fields
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} SamplingParams
 * @property {number} temp - Temperature [0.0, 2.0]
 * @property {number} topK - Top-K [0, 1000]
 * @property {number} topP - Top-P [0.0, 1.0]
 * @property {number} repeatPenalty - Repeat penalty [0.0, 2.0]
 * @property {number} presencePenalty - Presence penalty [-2.0, 2.0]
 * @property {number} frequencyPenalty - Frequency penalty [-2.0, 2.0]
 * @property {number} seed - Random seed (-1 = random)
 */

/**
 * @typedef {'off' | 'draft-model' | 'mtp' | 'eagle3' | 'ngram' | 'ngram-simple'} SpeculativeMode
 */

/**
 * @typedef {Object} SpeculativeConfig
 * @property {boolean} enabled - Whether speculative decoding is enabled
 * @property {SpeculativeMode} mode - Speculative decoding mode
 * @property {string|null} draftModel - Path to draft model GGUF (null when disabled or non-draft mode)
 * @property {number} draftCtxSize - Draft model context size (>= 512)
 * @property {number} nMax - Max draft tokens to generate [1, 32]
 * @property {number} nMin - Min draft tokens before acceptance [1, 32]
 * @property {number} pMin - Min probability to accept a draft token [0.0, 1.0]
 */

/**
 * @typedef {Object} AdvancedArgs
 * @property {boolean} flashAttn - Flash attention flag
 * @property {boolean} mmap - Memory mapping (default true)
 * @property {boolean} mlock - Memory lock flag
 * @property {number} ctxSize - Context size (>= 512)
 * @property {number} batchSize - Batch size (>= 32)
 * @property {number} ubatchSize - Ubatch size (>= 32, <= batchSize)
 * @property {number} parallel - Parallel sequences (>= 1)
 * @property {number[]} tensorSplit - Tensor split values (non-negative, finite)
 * @property {number} mainGpu - Main GPU index (>= 0)
 * @property {'none'|'layer'|'row'} splitMode - Split mode
 * @property {string[]} rpc - RPC endpoints (format: "host:port")
 * @property {boolean} contBatching - Continuous batching
 * @property {SamplingParams} sampling - Sampling parameters
 * @property {SpeculativeConfig} speculative - Speculative decoding config
 * @property {number} nGpuLayers - GPU layer count, integer in [-1, 999]; -1 means "let llama-server decide" (Req 1.1)
 * @property {KvCacheType} typeK - K-cache precision (Req 2.1)
 * @property {KvCacheType} typeV - V-cache precision (Req 2.1)
 * @property {number} nCpuMoe - MoE CPU-offload expert-layer count, integer in [0, 999] (Req 3.1)
 * @property {number} threads - Thread count, integer in [1, 256] (Req 4.1)
 */

/**
 * @typedef {'f32' | 'f16' | 'q8_0' | 'q5_1' | 'q5_0' | 'q4_1' | 'q4_0' | 'turbo2_0' | 'turbo3_0' | 'turbo4_0'} KvCacheType
 */

/**
 * Named error thrown by kvPrecisionBytes for non-member inputs (Req 2.4, P39).
 */
class UnknownKvCacheTypeError extends Error {
  constructor(value) {
    super(`Unknown KV cache type: ${JSON.stringify(value)}`);
    this.name = 'UnknownKvCacheTypeError';
    this.value = value;
  }
}

/**
 * Per-element byte cost for each supported KV cache precision (Req 2.4).
 *
 * Values are frozen so the table cannot be mutated at runtime.
 * f16 is the reference precision (baseline ratio 1.0).
 * TurboQuant values are based on the paper's compression ratios:
 *   turbo4_0: 3.8x -> 2/3.8 = 0.5263 bytes per channel
 *   turbo3_0: 4.9x -> 2/4.9 = 0.4082 bytes per channel
 *   turbo2_0: 6.4x -> 2/6.4 = 0.3125 bytes per channel
 * @type {Readonly<Record<KvCacheType, number>>}
 */
const KV_PRECISION_BYTES = Object.freeze({
  f32: 4,
  f16: 2,
  q8_0: 1,
  q5_1: 0.75,
  q5_0: 0.625,
  q4_1: 0.5625,
  q4_0: 0.5,
  // TurboQuant types (added in Phase 3)
  turbo4_0: 0.526315789,
  turbo3_0: 0.408163265,
  turbo2_0: 0.3125,
});

/**
 * Set of TurboQuant type names for quick membership tests.
 * @type {ReadonlySet<string>}
 */
const TURBOQUANT_TYPES = Object.freeze(
  new Set(['turbo2_0', 'turbo3_0', 'turbo4_0'])
);

/**
 * Total function over KV cache types (Req 2.4, P39).
 *
 * Looks up the per-element byte cost for the given cache type. For any input
 * that is not one of the documented strings (including non-strings,
 * `null`, `undefined`, numbers, and unknown strings) this throws
 * `UnknownKvCacheTypeError` so callers cannot silently receive `undefined`.
 *
 * @param {KvCacheType} kvCacheType
 * @returns {number} strictly positive finite byte cost per element
 * @throws {UnknownKvCacheTypeError}
 */
function kvPrecisionBytes(kvCacheType) {
  if (
    typeof kvCacheType === 'string' &&
    Object.prototype.hasOwnProperty.call(KV_PRECISION_BYTES, kvCacheType)
  ) {
    return KV_PRECISION_BYTES[kvCacheType];
  }
  throw new UnknownKvCacheTypeError(kvCacheType);
}

/**
 * Detects the host's physical core count (Req 4.2).
 *
 * Pure wrapper around `os.cpus()`. Deduplicates by the combined `model` +
 * `speed` signature so hyper-threaded logical CPUs do not double-count
 * physical cores on hosts where every logical CPU reports an identical tuple.
 * Clamps to `[1, 256]` and falls back to `4` on empty arrays or when
 * `os.cpus()` throws. Emits no warnings.
 *
 * @param {{ cpus: () => Array<{ model: string, speed: number }> }} [osModule]
 *        Injectable for testing; defaults to Node's built-in `os`.
 * @returns {number} integer in [1, 256]
 */
function detectPhysicalCores(osModule = require('os')) {
  let cpus;
  try {
    cpus = osModule.cpus();
  } catch (_err) {
    return 4;
  }
  if (!Array.isArray(cpus) || cpus.length === 0) {
    return 4;
  }
  const signatures = new Set();
  for (const cpu of cpus) {
    if (cpu && typeof cpu === 'object') {
      signatures.add(`${cpu.model}|${cpu.speed}`);
    }
  }
  const count = signatures.size;
  if (count <= 0) {
    return 4;
  }
  if (count > 256) {
    return 256;
  }
  return count;
}

/**
 * Memory-tuning defaults introduced in phase-2 (Req 1.1, 2.1, 3.1, 4.1).
 *
 * Kept as a separately exported frozen object so consumers (settings UI,
 * ModelConfigStore forward-compat read) can merge only the new keys without
 * touching the phase-1 surface.
 * @type {Readonly<{ nGpuLayers: number, typeK: KvCacheType, typeV: KvCacheType, nCpuMoe: number, threads: number }>}
 */
const MEMORY_ADVANCED_DEFAULTS = Object.freeze({
  nGpuLayers: -1,
  typeK: 'f16',
  typeV: 'f16',
  nCpuMoe: 0,
  threads: 4,
});

/**
 * Documented defaults for Advanced_Args (Req 20.3, extended by Reqs 1.1, 2.1, 3.1, 4.1)
 * @type {AdvancedArgs}
 */
const DEFAULT_ADVANCED_ARGS = {
  flashAttn: false,
  mmap: true,
  mlock: false,
  ctxSize: 4096,
  batchSize: 2048,
  ubatchSize: 512,
  parallel: 1,
  tensorSplit: [],
  mainGpu: 0,
  splitMode: 'layer',
  rpc: [],
  contBatching: true,
  sampling: {
    temp: 0.8,
    topK: 40,
    topP: 0.95,
    repeatPenalty: 1.1,
    presencePenalty: 0.0,
    frequencyPenalty: 0.0,
    seed: -1,
  },
  speculative: {
    enabled: false,
    mode: 'draft-model',
    draftModel: null,
    draftCtxSize: 4096,
    nMax: 16,
    nMin: 4,
    pMin: 0.8,
  },
  // Phase-2 memory-tuning fields (merged additively)
  ...MEMORY_ADVANCED_DEFAULTS,
};

/**
 * All known KV cache types as a comma-separated string (for error messages).
 * @returns {string}
 */
function kvCacheTypeList() {
  return Object.keys(KV_PRECISION_BYTES).join("', '");
}

/**
 * Validates Advanced_Args against schema constraints.
 * Returns { ok: true } on success or { ok: false, field, reason } on failure.
 *
 * Validates:
 * - Numeric ranges (Req 9.1, 10.1, 11.1, 12.1)
 * - ubatchSize <= batchSize (Req 9.6)
 * - rpc entries matching /^[^\s:]+:\d+$/ (Req 10.7)
 * - tensorSplit entries non-negative finite (Req 10.8)
 * - splitMode in {'none','layer','row'} (Req 10.1)
 * - speculative.enabled implying draftModel exists on disk for draft-model mode
 * - speculative.nMax/nMin/pMin ranges
 * - typeK/typeV in KV_PRECISION_BYTES including turbo* types
 *
 * @param {AdvancedArgs} a - The Advanced_Args object to validate
 * @returns {{ ok: true } | { ok: false, field: string, reason: string }}
 */
function validateAdvancedArgs(a) {
  if (!a || typeof a !== 'object') {
    return { ok: false, field: 'root', reason: 'Advanced_Args must be an object' };
  }

  // Performance / memory flags (Req 9)
  if (typeof a.flashAttn !== 'boolean') {
    return { ok: false, field: 'flashAttn', reason: 'Must be boolean' };
  }
  if (typeof a.mmap !== 'boolean') {
    return { ok: false, field: 'mmap', reason: 'Must be boolean' };
  }
  if (typeof a.mlock !== 'boolean') {
    return { ok: false, field: 'mlock', reason: 'Must be boolean' };
  }

  // Context and batch sizes (Req 9.1)
  if (!Number.isInteger(a.ctxSize) || a.ctxSize < 512) {
    return { ok: false, field: 'ctxSize', reason: 'Must be integer >= 512' };
  }
  if (!Number.isInteger(a.batchSize) || a.batchSize < 32) {
    return { ok: false, field: 'batchSize', reason: 'Must be integer >= 32' };
  }
  if (!Number.isInteger(a.ubatchSize) || a.ubatchSize < 32) {
    return { ok: false, field: 'ubatchSize', reason: 'Must be integer >= 32' };
  }

  // ubatchSize <= batchSize (Req 9.6)
  if (a.ubatchSize > a.batchSize) {
    return { ok: false, field: 'ubatchSize', reason: 'Must be <= batchSize' };
  }

  // Parallel (Req 9.1)
  if (!Number.isInteger(a.parallel) || a.parallel < 1) {
    return { ok: false, field: 'parallel', reason: 'Must be integer >= 1' };
  }

  // Multi-GPU / distributed (Req 10)
  if (!Array.isArray(a.tensorSplit)) {
    return { ok: false, field: 'tensorSplit', reason: 'Must be array' };
  }

  // tensorSplit entries non-negative finite (Req 10.8)
  for (let i = 0; i < a.tensorSplit.length; i++) {
    const val = a.tensorSplit[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return {
        ok: false,
        field: `tensorSplit[${i}]`,
        reason: 'Must be non-negative finite number',
      };
    }
  }

  // mainGpu (Req 10.1)
  if (!Number.isInteger(a.mainGpu) || a.mainGpu < 0) {
    return { ok: false, field: 'mainGpu', reason: 'Must be integer >= 0' };
  }

  // splitMode (Req 10.1)
  if (!['none', 'layer', 'row'].includes(a.splitMode)) {
    return { ok: false, field: 'splitMode', reason: "Must be 'none', 'layer', or 'row'" };
  }

  // rpc entries (Req 10.7)
  if (!Array.isArray(a.rpc)) {
    return { ok: false, field: 'rpc', reason: 'Must be array' };
  }
  const rpcRegex = /^[^\s:]+:\d+$/;
  for (let i = 0; i < a.rpc.length; i++) {
    const entry = a.rpc[i];
    if (typeof entry !== 'string' || !rpcRegex.test(entry)) {
      return {
        ok: false,
        field: `rpc[${i}]`,
        reason: 'Must match format "host:port" (no spaces)',
      };
    }
  }

  // contBatching (Req 10.1)
  if (typeof a.contBatching !== 'boolean') {
    return { ok: false, field: 'contBatching', reason: 'Must be boolean' };
  }

  // Sampling params (Req 11.1)
  if (!a.sampling || typeof a.sampling !== 'object') {
    return { ok: false, field: 'sampling', reason: 'Must be object' };
  }

  const samplingRanges = {
    temp: [0.0, 2.0],
    topK: [0, 1000],
    topP: [0.0, 1.0],
    repeatPenalty: [0.0, 2.0],
    presencePenalty: [-2.0, 2.0],
    frequencyPenalty: [-2.0, 2.0],
  };

  for (const [field, [min, max]] of Object.entries(samplingRanges)) {
    const val = a.sampling[field];
    if (typeof val !== 'number' || val < min || val > max) {
      return {
        ok: false,
        field: `sampling.${field}`,
        reason: `Must be number in [${min}, ${max}]`,
      };
    }
  }

  // seed (Req 11.1)
  if (!Number.isInteger(a.sampling.seed)) {
    return { ok: false, field: 'sampling.seed', reason: 'Must be integer' };
  }

  // Speculative decoding (Req 12.1 + Phase 3 extensions)
  if (!a.speculative || typeof a.speculative !== 'object') {
    return { ok: false, field: 'speculative', reason: 'Must be object' };
  }

  if (typeof a.speculative.enabled !== 'boolean') {
    return { ok: false, field: 'speculative.enabled', reason: 'Must be boolean' };
  }

  const validModes = ['off', 'draft-model', 'mtp', 'eagle3', 'ngram', 'ngram-simple'];
  if (!validModes.includes(a.speculative.mode)) {
    return {
      ok: false,
      field: 'speculative.mode',
      reason: `Must be one of ${validModes.join(', ')}`,
    };
  }

  // draftModel is required only for draft-model mode when enabled
  if (a.speculative.enabled && a.speculative.mode === 'draft-model') {
    if (typeof a.speculative.draftModel !== 'string' || !a.speculative.draftModel) {
      return {
        ok: false,
        field: 'speculative.draftModel',
        reason: 'Must be non-empty string when speculative mode is draft-model and enabled',
      };
    }

    // Check if file exists on disk
    if (!fs.existsSync(a.speculative.draftModel)) {
      return {
        ok: false,
        field: 'speculative.draftModel',
        reason: `File does not exist: ${a.speculative.draftModel}`,
      };
    }
  }

  // draftCtxSize (Req 12.1)
  if (!Number.isInteger(a.speculative.draftCtxSize) || a.speculative.draftCtxSize < 512) {
    return { ok: false, field: 'speculative.draftCtxSize', reason: 'Must be integer >= 512' };
  }

  // nMax / nMin / pMin (Phase 3)
  if (!Number.isInteger(a.speculative.nMax) || a.speculative.nMax < 1 || a.speculative.nMax > 32) {
    return { ok: false, field: 'speculative.nMax', reason: 'Must be integer in [1, 32]' };
  }
  if (!Number.isInteger(a.speculative.nMin) || a.speculative.nMin < 1 || a.speculative.nMin > 32) {
    return { ok: false, field: 'speculative.nMin', reason: 'Must be integer in [1, 32]' };
  }
  if (typeof a.speculative.pMin !== 'number' || a.speculative.pMin < 0.0 || a.speculative.pMin > 1.0) {
    return { ok: false, field: 'speculative.pMin', reason: 'Must be number in [0.0, 1.0]' };
  }

  // -------------------------------------------------------------------------
  // Phase-2 memory-tuning checks (Reqs 1.5, 2.3, 3.4, 4.4)
  // -------------------------------------------------------------------------

  // nGpuLayers (Req 1.5)
  if (!Number.isInteger(a.nGpuLayers) || a.nGpuLayers < -1 || a.nGpuLayers > 999) {
    return { ok: false, field: 'nGpuLayers', reason: 'Must be integer in [-1, 999]' };
  }

  // typeK (Req 2.3) — now includes turbo* types
  if (
    typeof a.typeK !== 'string' ||
    !Object.prototype.hasOwnProperty.call(KV_PRECISION_BYTES, a.typeK)
  ) {
    return {
      ok: false,
      field: 'typeK',
      reason: `Must be one of '${kvCacheTypeList()}'`,
    };
  }

  // typeV (Req 2.3) — now includes turbo* types
  if (
    typeof a.typeV !== 'string' ||
    !Object.prototype.hasOwnProperty.call(KV_PRECISION_BYTES, a.typeV)
  ) {
    return {
      ok: false,
      field: 'typeV',
      reason: `Must be one of '${kvCacheTypeList()}'`,
    };
  }

  // nCpuMoe (Req 3.4)
  if (!Number.isInteger(a.nCpuMoe) || a.nCpuMoe < 0 || a.nCpuMoe > 999) {
    return { ok: false, field: 'nCpuMoe', reason: 'Must be integer in [0, 999]' };
  }

  // threads (Req 4.4)
  if (!Number.isInteger(a.threads) || a.threads < 1 || a.threads > 256) {
    return { ok: false, field: 'threads', reason: 'Must be integer in [1, 256]' };
  }

  return { ok: true };
}

/**
 * Serializes Advanced_Args to JSON string (Req 20.6, Req 11.3).
 *
 * The phase-2 memory-tuning fields (`nGpuLayers`, `typeK`, `typeV`, `nCpuMoe`,
 * `threads`) are plain JSON scalars/strings, so the existing JSON.stringify
 * implementation carries them through the round-trip unchanged.
 * @param {AdvancedArgs} a - The Advanced_Args object
 * @returns {string} JSON string
 */
function serializeAdvancedArgs(a) {
  return JSON.stringify(a);
}

/**
 * Parses Advanced_Args from JSON string (Req 20.6, Req 11.3).
 *
 * The phase-2 memory-tuning fields are parsed identically to the phase-1
 * fields; forward-compatibility for phase-1-shaped JSON (missing keys) is
 * handled separately by ModelConfigStore's `normalizeExtendedAdvancedArgs`.
 * @param {string} s - JSON string
 * @returns {AdvancedArgs} Parsed Advanced_Args object
 * @throws {SyntaxError} If JSON is invalid
 */
function parseAdvancedArgs(s) {
  return JSON.parse(s);
}

module.exports = {
  DEFAULT_ADVANCED_ARGS,
  MEMORY_ADVANCED_DEFAULTS,
  KV_PRECISION_BYTES,
  TURBOQUANT_TYPES,
  UnknownKvCacheTypeError,
  kvPrecisionBytes,
  detectPhysicalCores,
  validateAdvancedArgs,
  serializeAdvancedArgs,
  parseAdvancedArgs,
};
