/**
 * Model Config Store
 *
 * Wraps electron-store to persist and manage per-model Advanced_Args configurations.
 * Provides atomic get/set operations, fallback to defaults, and reconciliation with
 * models on disk.
 *
 * Phase 1 requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 *
 * Phase 2 (llama-cpp-memory-tuning) adds, additively:
 *   - `normalizeExtendedAdvancedArgs(raw, filename, logger)` — forward-compatible
 *     read helper that fills any missing memory-tuning keys with their documented
 *     defaults and substitutes defaults for wrong-type values with a one-line
 *     warning. Wired into `get` / `getOrDefault` / `listAll` BEFORE
 *     `validateAdvancedArgs` so phase-1-shaped JSON loads cleanly on first read.
 *     (Reqs 11.1, 11.2, 11.3, 11.4 — Property P66.)
 *
 * Phase 3 (mtp-turboquant-presets) adds, additively:
 *   - `DEFAULT_SPECULATIVE` frozen default for the new speculative sub-fields.
 *   - `normalizeExtendedAdvancedArgs` now also merges missing speculative keys
 *     (mode, nMax, nMin, pMin) from `DEFAULT_SPECULATIVE` so phase-1/2 configs
 *     load cleanly.
 *
 * The normalise step does NOT call `store.set`; the on-disk payload is only
 * rewritten when the user explicitly saves the model's Advanced_Args (Req 11.2
 * tail). Phase-1 `delete` / `reconcile` / `set` behaviour is unchanged.
 */

const {
  DEFAULT_ADVANCED_ARGS,
  MEMORY_ADVANCED_DEFAULTS,
  KV_PRECISION_BYTES,
  validateAdvancedArgs,
  parseAdvancedArgs,
  serializeAdvancedArgs,
} = require('./advanced-args');

/**
 * Custom error for config parsing failures
 */
class ConfigParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigParseError';
  }
}

/**
 * Per-key type guards for the five phase-2 memory-tuning fields (Req 11.4).
 *
 * Each predicate returns `true` iff the raw value is a legal, in-range value
 * for that field. Mismatches trigger a substituted default in
 * `normalizeExtendedAdvancedArgs` along with a single `logger.warn` line.
 */
const MEMORY_FIELD_GUARDS = Object.freeze({
  nGpuLayers: (v) => Number.isInteger(v) && v >= -1 && v <= 999,
  typeK: (v) =>
    typeof v === 'string' &&
    Object.prototype.hasOwnProperty.call(KV_PRECISION_BYTES, v),
  typeV: (v) =>
    typeof v === 'string' &&
    Object.prototype.hasOwnProperty.call(KV_PRECISION_BYTES, v),
  nCpuMoe: (v) => Number.isInteger(v) && v >= 0 && v <= 999,
  threads: (v) => Number.isInteger(v) && v >= 1 && v <= 256,
});

// Explicit, fixed iteration order for deterministic normalisation behaviour.
const MEMORY_FIELD_ORDER = Object.freeze([
  'nGpuLayers',
  'typeK',
  'typeV',
  'nCpuMoe',
  'threads',
]);

/**
 * Default speculative sub-fields for forward-compatibility (Phase 3).
 * Old configs missing `mode`, `nMax`, `nMin`, or `pMin` are silently upgraded.
 * @type {Readonly<Object>}
 */
const DEFAULT_SPECULATIVE = Object.freeze({
  enabled: false,
  mode: 'draft-model',
  draftModel: null,
  draftCtxSize: 4096,
  nMax: 16,
  nMin: 4,
  pMin: 0.8,
});

/**
 * Forward-compatible normaliser for the phase-2/3 Advanced_Args extension
 * (Reqs 11.1, 11.2, 11.4 — Property P66).
 *
 * For each of the five memory-tuning keys (`nGpuLayers`, `typeK`, `typeV`,
 * `nCpuMoe`, `threads`):
 *  - If the key is missing from `raw`, it is filled with
 *    `MEMORY_ADVANCED_DEFAULTS[key]` SILENTLY. Phase-1-shaped JSON (i.e.,
 *    written by a pre-phase-2 installation) must continue to load without
 *    spurious warnings (Req 11.2).
 *  - If the key is present but fails the per-key type guard, a single line
 *    `"[ModelConfigStore] <filename>: <field> has invalid type, substituting default"`
 *    is emitted via `logger.warn`, the default is substituted, and loading
 *    continues for the remaining fields (Req 11.4).
 *
 * Additionally, the `speculative` sub-object is merged with `DEFAULT_SPECULATIVE`
 * so phase-1/2 configs that lack `mode`, `nMax`, `nMin`, or `pMin` load cleanly.
 *
 * The function does NOT mutate `raw` (defensive shallow copy), does NOT call
 * `store.set`, and does NOT perform any other I/O. Callers are expected to
 * invoke this BEFORE `validateAdvancedArgs` so the validator sees a fully
 * populated extended Advanced_Args object.
 *
 * @param {Object} raw - Parsed Advanced_Args object as read from the store.
 * @param {string} filename - Model filename (used only for the warning line).
 * @param {{ warn: (msg: string) => void }} logger - Logger (defaults to console).
 * @returns {Object} A new object with every memory-tuning key present and
 *   either the original legal value or the documented default. Non-object
 *   inputs (null/undefined/primitives) are returned unchanged so the caller
 *   can handle the corrupt-config case uniformly.
 */
function normalizeExtendedAdvancedArgs(raw, filename, logger = console) {
  // Non-object inputs are left alone; the caller's existing error path
  // (ConfigParseError in `get`, try/catch skip in `listAll`) will handle them.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const normalized = { ...raw };

  for (const key of MEMORY_FIELD_ORDER) {
    const hasKey = Object.prototype.hasOwnProperty.call(raw, key);

    if (!hasKey) {
      // Missing key: fill silently with the documented default (Req 11.2).
      normalized[key] = MEMORY_ADVANCED_DEFAULTS[key];
      continue;
    }

    // Key is present; check the per-key type guard (Req 11.4).
    const guard = MEMORY_FIELD_GUARDS[key];
    if (!guard(raw[key])) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(
          `[ModelConfigStore] ${filename}: ${key} has invalid type, substituting default`
        );
      }
      normalized[key] = MEMORY_ADVANCED_DEFAULTS[key];
    }
    // Otherwise the value is already legal; keep it as-is (no log).
  }

  // Phase-3: speculative sub-field forward-compat.
  // Old configs may have a partial speculative object (missing mode/nMax/nMin/pMin).
  // We merge defaults in silently without mutating the on-disk payload.
  if (typeof normalized.speculative !== 'object' || normalized.speculative === null) {
    normalized.speculative = { ...DEFAULT_SPECULATIVE };
  } else {
    normalized.speculative = { ...DEFAULT_SPECULATIVE, ...normalized.speculative };
  }

  return normalized;
}

/**
 * Model Config Store class
 *
 * Wraps electron-store to persist per-model Advanced_Args configurations.
 * Provides atomic operations and fallback to documented defaults.
 */
class ModelConfigStore {
  /**
   * Constructor
   *
   * @param {Object} store - electron-store instance
   * @param {Object} options - Configuration options
   * @param {Function} options.logger - Logger function (default: console)
   */
  constructor(store, { logger = console } = {}) {
    this.store = store;
    this.logger = logger;
    this.configKey = 'modelConfigs';

    // Initialize the modelConfigs key if it doesn't exist
    if (!this.store.has(this.configKey)) {
      this.store.set(this.configKey, {});
    }
  }

  /**
   * Get Advanced_Args for a model
   *
   * Returns the stored Advanced_Args for a model, or null if not found.
   * Logs a warning and returns null if the stored config is corrupt.
   *
   * Phase-2/3 (Req 11.1, 11.2, 11.4): the parsed object is run through
   * `normalizeExtendedAdvancedArgs` BEFORE `validateAdvancedArgs` so
   * phase-1/2-shaped JSON loads cleanly and wrong-type values are reported
   * and substituted without failing the whole read.
   *
   * Requirements: 20.1, 11.1, 11.2, 11.4
   *
   * @param {string} modelFilename - The model filename (key)
   * @returns {Object|null} Advanced_Args or null if not found
   */
  get(modelFilename) {
    try {
      const configs = this.store.get(this.configKey, {});
      const configStr = configs[modelFilename];

      if (!configStr) {
        return null;
      }

      // Parse first, then forward-compat-normalise, then validate. The
      // normalise step is side-effect-free except for the one-line warnings
      // it may emit — it does NOT call `store.set` (Req 11.2 tail).
      const parsed = parseAdvancedArgs(configStr);
      const config = normalizeExtendedAdvancedArgs(
        parsed,
        modelFilename,
        this.logger
      );
      const validation = validateAdvancedArgs(config);

      if (!validation.ok) {
        throw new ConfigParseError(`Invalid config: ${validation.reason}`);
      }

      return config;
    } catch (err) {
      this.logger.warn(
        `[ModelConfigStore] Failed to parse config for '${modelFilename}': ${err.message}`
      );
      return null;
    }
  }

  /**
   * Get Advanced_Args for a model, falling back to defaults
   *
   * Returns the stored Advanced_Args for a model, or DEFAULT_ADVANCED_ARGS if not found
   * or if the stored config is corrupt. DEFAULT_ADVANCED_ARGS already contains the
   * phase-2/3 defaults so the fallback shape is fully populated.
   *
   * Requirements: 20.3, 11.2
   *
   * @param {string} modelFilename - The model filename (key)
   * @returns {Object} Advanced_Args (never null)
   */
  getOrDefault(modelFilename) {
    const config = this.get(modelFilename);
    return config || { ...DEFAULT_ADVANCED_ARGS };
  }

  /**
   * Set Advanced_Args for a model (atomic)
   *
   * Atomically stores Advanced_Args for a model. Uses electron-store's
   * temp-then-rename mechanism for atomicity.
   *
   * Phase-2/3 note: the `set` path is unchanged from phase-1. On-disk rewrite
   * only happens when the user explicitly saves, so the normaliser is NOT
   * invoked here.
   *
   * Requirements: 20.2
   *
   * @param {string} modelFilename - The model filename (key)
   * @param {Object} config - The Advanced_Args object to store
   */
  set(modelFilename, config) {
    const validation = validateAdvancedArgs(config);
    if (!validation.ok) {
      throw new ConfigParseError(
        `Cannot save invalid config for '${modelFilename}': ${validation.field} – ${validation.reason}`
      );
    }

    const configs = this.store.get(this.configKey, {});
    configs[modelFilename] = serializeAdvancedArgs(config);
    this.store.set(this.configKey, configs);
  }

  /**
   * Delete Advanced_Args for a model
   *
   * Removes the stored configuration for a model. If the model has no stored
   * config, this is a no-op.
   *
   * Requirements: 20.4
   *
   * @param {string} modelFilename - The model filename (key)
   */
  delete(modelFilename) {
    const configs = this.store.get(this.configKey, {});
    if (Object.prototype.hasOwnProperty.call(configs, modelFilename)) {
      delete configs[modelFilename];
      this.store.set(this.configKey, configs);
    }
  }

  /**
   * List all stored model configurations
   *
   * Returns an array of { filename, config } objects for every model that has
   * a stored configuration. Corrupt entries are skipped with a warning rather
   * than halting the enumeration.
   *
   * Phase-2/3 note: each entry is normalised before validation so partial
   * shapes still surface when possible.
   *
   * Requirements: 20.5
   *
   * @returns {Array<{filename: string, config: Object}>}
   */
  listAll() {
    const configs = this.store.get(this.configKey, {});
    const results = [];

    for (const [filename, configStr] of Object.entries(configs)) {
      try {
        const parsed = parseAdvancedArgs(configStr);
        const config = normalizeExtendedAdvancedArgs(
          parsed,
          filename,
          this.logger
        );
        const validation = validateAdvancedArgs(config);
        if (validation.ok) {
          results.push({ filename, config });
        } else {
          this.logger.warn(
            `[ModelConfigStore] Skipping corrupt config for '${filename}': ${validation.reason}`
          );
        }
      } catch (err) {
        this.logger.warn(
          `[ModelConfigStore] Skipping unreadable config for '${filename}': ${err.message}`
        );
      }
    }

    return results;
  }

  /**
   * Reconcile stored configs with models on disk
   *
   * Removes stored configurations for models that no longer exist on disk.
   * Keeps configs for models that are still present.
   *
   * @param {string[]} existingFilenames - Array of model filenames that exist
   */
  reconcile(existingFilenames) {
    const existingSet = new Set(existingFilenames);
    const configs = this.store.get(this.configKey, {});
    let changed = false;

    for (const filename of Object.keys(configs)) {
      if (!existingSet.has(filename)) {
        delete configs[filename];
        changed = true;
      }
    }

    if (changed) {
      this.store.set(this.configKey, configs);
    }
  }
}

module.exports = {
  ConfigParseError,
  MEMORY_FIELD_GUARDS,
  MEMORY_FIELD_ORDER,
  DEFAULT_SPECULATIVE,
  normalizeExtendedAdvancedArgs,
  ModelConfigStore,
};
