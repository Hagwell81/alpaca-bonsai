/**
 * @fileoverview Preset recommender for the llama-cpp-memory-tuning spec.
 *
 * Exposes:
 *   - `recommendPreset(modelMeta, budget)` — pure function that returns a
 *     complete, validated Advanced_Args object tuned to the model's class
 *     and the detected VRAM budget (design §4 / Reqs 9.1–9.10 / P61–P64).
 *
 * Phase-3 (mtp-turboquant-presets) enhancements:
 *   - Queries `model-preset-db.js` for architecture/filename-specific overrides.
 *   - Model-specific presets take priority over generic classification.
 *   - More aggressive KV compression is applied to large models even when
 *     total VRAM appears generous, because KV cache scales with context.
 *   - Speculative MTP defaults are pulled from the model database when present.
 *
 * Purity contract (Req 9.10): this module performs no disk I/O, no process
 * spawns, no network requests, and no clock reads. All exported functions
 * are deterministic total functions on their documented input domains, so
 * two successive calls with the same arguments always return structurally
 * identical results (P62).
 *
 * Validates (Requirements): 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10.
 * Property tests depending on this module: P61, P62, P63, P64.
 */

'use strict';

const { DEFAULT_ADVANCED_ARGS } = require('./advanced-args');
const { classifyModel, inferTotalLayers } = require('./model-classifier');
const { autoTuneNgl } = require('./ngl-optimizer');
const { lookupPreset } = require('./model-preset-db');

/**
 * @typedef {import('./advanced-args').AdvancedArgs} AdvancedArgs
 * @typedef {import('./model-classifier').ModelMeta} ModelMeta
 */

/**
 * @typedef {Object} Budget
 * @property {boolean} detected
 * @property {number}  totalVramMB
 * @property {number}  reservedMB
 * @property {number}  gpuCount
 * @property {number}  physicalCores
 */

/**
 * Deep-clone an object (shallow is enough for Advanced_Args overrides).
 * @param {object|null|undefined} obj
 * @returns {object}
 */
function clone(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merges a source object into a target object at the top level and one
 * nested level deep (e.g., `speculative` sub-object).
 * Arrays are replaced, not merged.
 *
 * @param {object} target
 * @param {object|null|undefined} source
 * @returns {object} mutated target
 */
function mergeDeep(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = target[key];
    if (
      sVal !== null &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      tVal !== null &&
      typeof tVal === 'object' &&
      !Array.isArray(tVal)
    ) {
      target[key] = { ...tVal, ...sVal };
    } else {
      target[key] = sVal;
    }
  }
  return target;
}

/**
 * Clamps `value` to the range `[min, max]`.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Returns a complete Advanced_Args preset tuned to the model's class and
 * the detected VRAM budget.
 *
 * Algorithm (design §4):
 *   1. Look up a model-specific preset from `model-preset-db.js`.
 *      If found, those overrides become the starting point.
 *   2. If no exact preset, classify the model into one of four classes:
 *      `dense-small`, `dense-large`, `moe-small`, `moe-large`.
 *   3. Pick KV cache precision:
 *      - Model-specific preset says something → use it.
 *      - `totalVramMB < 8 GiB`  → `q5_0` / `q5_0` (aggressive for very low VRAM)
 *      - `totalVramMB < 12 GiB` → `q8_0` / `q8_0` (moderate compression)
 *      - `totalVramMB < 20 GiB` and `dense-large` / `moe-large` → `q5_0` / `q5_0`
 *      - otherwise → `f16` / `f16`
 *   4. Start from `DEFAULT_ADVANCED_ARGS` with explicit overrides:
 *      - `flashAttn = true`
 *      - `ctxSize = 4096`, `batchSize = 512`, `ubatchSize = 512`, `parallel = 1`
 *      - `threads = clamp(budget.physicalCores, 1, 256)`
 *      - `splitMode = 'layer'` when `gpuCount > 1`
 *      - `tensorSplit = []`
 *   5. Set `nGpuLayers`:
 *      - For `*-small` classes: full offload (`totalLayers`)
 *      - For `*-large` classes: `autoTuneNgl(...)`
 *   6. For MoE classes, set `nCpuMoe` to the complement of the fit-to-VRAM
 *      layer count: `max(0, totalLayers - fit)`.
 *   7. Merge model-specific overrides (step 1) on top of the generic preset.
 *
 * The output always passes `validateAdvancedArgs` by construction (Req 9.1 / P61):
 *   - All numeric assignments are either clamped, known-legal constants, or
 *     produced by `autoTuneNgl` (which returns integers in `[0, totalLayers]`).
 *   - All string assignments are literals from the documented enums.
 *   - All boolean assignments are literals.
 *
 * Purity contract (Req 9.10): no I/O, no process, no network, no clock,
 * no env reads. Determinism (Req 9.9 / P62) follows directly.
 *
 * @param {ModelMeta|null|undefined} modelMeta
 * @param {Budget|null|undefined} budget
 * @returns {AdvancedArgs} Complete Advanced_Args object (passes validateAdvancedArgs)
 */
function recommendPreset(modelMeta, budget) {
  // --- Input coercion --------------------------------------------------------
  const meta = (modelMeta !== null && typeof modelMeta === 'object') ? modelMeta : {};
  const bud = (budget !== null && typeof budget === 'object') ? budget : {};

  // --- Classify model --------------------------------------------------------
  const cls = classifyModel(meta);
  const isMoE = cls.startsWith('moe');
  const isLarge = cls.endsWith('-large');
  const totalLayers = inferTotalLayers(meta);

  // --- Look up model-specific preset ----------------------------------------
  const modelPreset = lookupPreset(meta);
  const hasExactPreset = modelPreset.confidence === 'exact' || modelPreset.confidence === 'architecture';

  // --- Pick KV cache precision ----------------------------------------------
  const totalVramMB = Number.isFinite(bud.totalVramMB) && bud.totalVramMB > 0
    ? bud.totalVramMB
    : 0;

  let typeK = 'f16';
  let typeV = 'f16';

  if (hasExactPreset && modelPreset.overrides) {
    // Model database knows best.
    if (modelPreset.overrides.typeK) typeK = modelPreset.overrides.typeK;
    if (modelPreset.overrides.typeV) typeV = modelPreset.overrides.typeV;
  } else {
    // Generic heuristic based on VRAM and model size class.
    const veryLowVram = totalVramMB < 8 * 1024;
    const lowVram = totalVramMB < 12 * 1024;
    const midVram = totalVramMB < 20 * 1024;

    if (veryLowVram) {
      typeK = 'q5_0';
      typeV = 'q5_0';
    } else if (lowVram) {
      typeK = 'q8_0';
      typeV = 'q8_0';
    } else if (midVram && isLarge) {
      // Large models on mid-range VRAM still benefit from compression
      // because KV cache grows with layer count and context length.
      typeK = 'q5_0';
      typeV = 'q5_0';
    }
    // Otherwise keep f16 / f16 for high-VRAM + small-model combos.
  }

  // --- Extract budget fields -------------------------------------------------
  const reservedMB = Number.isFinite(bud.reservedMB) && bud.reservedMB >= 0
    ? bud.reservedMB
    : 0;
  const gpuCount = Number.isFinite(bud.gpuCount) && bud.gpuCount >= 0
    ? Math.floor(bud.gpuCount)
    : 1;
  const physicalCores = Number.isFinite(bud.physicalCores)
    ? Math.floor(bud.physicalCores)
    : 4;

  // --- Build base preset (Reqs 9.5, 9.6, 9.7, 9.8) --------------------------
  const base = {
    ...DEFAULT_ADVANCED_ARGS,
    flashAttn: true,
    ctxSize: 4096,
    batchSize: 512,
    ubatchSize: 512,
    parallel: 1,
    typeK,
    typeV,
    threads: clamp(physicalCores, 1, 256),
    splitMode: gpuCount > 1 ? 'layer' : DEFAULT_ADVANCED_ARGS.splitMode,
    tensorSplit: [],
    nCpuMoe: 0,
    nGpuLayers: -1,
  };

  // --- Set nGpuLayers (Req 9.2) ----------------------------------------------
  if (!isLarge) {
    // Full offload for small models
    base.nGpuLayers = totalLayers;
  } else {
    // Auto-tune for large models
    const budgetForAutoTune = {
      detected: bud.detected === true,
      totalVramMB,
      reservedMB,
      gpuCount,
      physicalCores,
    };
    base.nGpuLayers = autoTuneNgl(meta, base, budgetForAutoTune, totalLayers, []);
  }

  // --- Set nCpuMoe for MoE models (Req 9.4) ----------------------------------
  if (isMoE) {
    const budgetForFit = {
      detected: bud.detected === true,
      totalVramMB,
      reservedMB,
      gpuCount,
      physicalCores,
    };
    const probeArgs = { ...base, nGpuLayers: -1 };
    const fit = autoTuneNgl(meta, probeArgs, budgetForFit, totalLayers, []);
    base.nCpuMoe = Math.max(0, totalLayers - fit);
  }

  // --- Merge model-specific overrides on top --------------------------------
  if (modelPreset.overrides) {
    mergeDeep(base, clone(modelPreset.overrides));
  }

  return base;
}

module.exports = {
  recommendPreset,
};
