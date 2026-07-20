/**
 * @fileoverview Runtime backend feature detector.
 *
 * Probes the active llama-server binary for supported command-line flags
 * by running `--help` and parsing the output. Results are cached so the
 * probe happens at most once per backend path.
 *
 * Exposes:
 *   - `probeBackendFeatures(binaryPath, logger)` -> `BackendFeatures`
 *   - `clearFeatureCache()`
 *
 * Purity contract: this module performs I/O (spawn + read), so it is NOT
 * pure. Callers should invoke it once at startup and cache the result.
 */

'use strict';

const { execSync } = require('child_process');

/**
 * @typedef {Object} BackendFeatures
 * @property {boolean} turboQuant   --type-k/--type-v support turbo* types
 * @property {boolean} speculative  --speculative flag available
 * @property {boolean} speculativeNMax  --speculative-n-max available
 * @property {boolean} speculativeNMin  --speculative-n-min available
 * @property {boolean} speculativePMin  --speculative-p-min available
 * @property {boolean} mtp          --speculative-type mtp (or auto-detected MTP)
 * @property {boolean} flashAttn    --flash-attn (should be present in all modern builds)
 * @property {boolean} nCpuMoe      --n-cpu-moe available
 * @property {string|null} versionTag  Parsed llama.cpp build tag if detectable
 */

/** In-memory cache: Map<binaryPath, BackendFeatures> */
const featureCache = new Map();

/**
 * Known help-text substrings that indicate a feature is present.
 * Each entry is [featureKey, substringPattern].
 */
const FEATURE_HEURISTICS = Object.freeze([
  ['turboQuant', 'TURBO'],
  ['turboQuant', 'turbo'],
  ['speculative', '--speculative'],
  ['speculativeNMax', '--speculative-n-max'],
  ['speculativeNMin', '--speculative-n-min'],
  ['speculativePMin', '--speculative-p-min'],
  ['mtp', 'MTP'],
  ['mtp', 'multi-token'],
  ['flashAttn', '--flash-attn'],
  ['nCpuMoe', '--n-cpu-moe'],
]);

/**
 * Regex to extract a build tag from the first line of `--version` output.
 * llama.cpp version lines look like:
 *   "version: 533 (f4c3dd5)"  or  "build: 4887 (8fcb5636)"
 */
const VERSION_TAG_RE = /(?:version|build):\s*(\d+)\s*\(/i;

/**
 * Regex to extract a "b1234" style tag from help/version output.
 */
const B_TAG_RE = /\bb(\d{4,})\b/;

/**
 * Probe a llama-server binary for supported features.
 *
 * @param {string|null|undefined} binaryPath Absolute path to llama-server binary.
 * @param {{ warn?: (msg: string) => void, debug?: (msg: string) => void }} [logger]
 * @returns {BackendFeatures}
 */
function probeBackendFeatures(binaryPath, logger = console) {
  if (!binaryPath || typeof binaryPath !== 'string') {
    return createEmptyFeatures();
  }

  // Return cached result if available.
  const cached = featureCache.get(binaryPath);
  if (cached) {
    return cached;
  }

  const features = createEmptyFeatures();

  try {
    // Run --help and capture stdout.
    const helpOutput = execSync(
      `"${binaryPath}" --help`,
      { encoding: 'utf8', timeout: 10000, windowsHide: true }
    );

    const helpLower = helpOutput.toLowerCase();

    for (const [featureKey, pattern] of FEATURE_HEURISTICS) {
      if (helpLower.includes(pattern.toLowerCase())) {
        features[featureKey] = true;
      }
    }

    // Try to extract a version/build number.
    const versionMatch = VERSION_TAG_RE.exec(helpOutput) || B_TAG_RE.exec(helpOutput);
    if (versionMatch) {
      features.versionTag = `b${versionMatch[1]}`;
    }

    if (logger.debug) {
      logger.debug(`[BackendFeatureDetector] Probed ${binaryPath}: ${JSON.stringify(features)}`);
    }
  } catch (err) {
    // Binary may not exist or may not support --help.
    if (logger.warn) {
      logger.warn(`[BackendFeatureDetector] Probe failed for ${binaryPath}: ${err.message}`);
    }
    // Leave all flags false.
  }

  featureCache.set(binaryPath, features);
  return features;
}

/**
 * Create a fresh empty feature object.
 * @returns {BackendFeatures}
 */
function createEmptyFeatures() {
  return {
    turboQuant: false,
    speculative: false,
    speculativeNMax: false,
    speculativeNMin: false,
    speculativePMin: false,
    mtp: false,
    flashAttn: false,
    nCpuMoe: false,
    versionTag: null,
  };
}

/**
 * Clear the in-memory feature cache. Useful when the backend binary is
 * updated or swapped at runtime.
 */
function clearFeatureCache() {
  featureCache.clear();
}

/**
 * Determine whether a specific KV cache type string is supported by the
 * probed backend.
 *
 * @param {BackendFeatures} features
 * @param {string} typeName
 * @returns {boolean}
 */
function isKvTypeSupported(features, typeName) {
  if (!features || typeof features !== 'object') return false;

  // Standard upstream types are always supported (assumed).
  const standardTypes = new Set([
    'f32', 'f16', 'q8_0', 'q8_1', 'q5_0', 'q5_1', 'q4_0', 'q4_1',
  ]);
  if (standardTypes.has(typeName)) return true;

  // TurboQuant types are only supported when the backend probe succeeded.
  if (typeName.startsWith('turbo')) {
    return features.turboQuant === true;
  }

  return false;
}

module.exports = {
  probeBackendFeatures,
  clearFeatureCache,
  isKvTypeSupported,
  createEmptyFeatures,
};
