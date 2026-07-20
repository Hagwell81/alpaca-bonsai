/**
 * VRAM Budget Manager
 *
 * Manages GPU VRAM allocation across multiple slots, enforces budget constraints,
 * and recommends eviction candidates when memory is insufficient.
 *
 * Phase-1 surface (canFit, rankEvictionCandidates, detectVram, VramBudgetManager)
 * is preserved unchanged for phase-1-shaped inputs. Phase-2 (`llama-cpp-memory-tuning`)
 * additively:
 *
 *   - Exports `PER_INSTANCE_OVERHEAD_MB = 256` (design §6 / Req 6.6)
 *   - Adds `estimateInactiveExpertMB(args)` helper (glossary "Inactive_Expert_Weight_MB")
 *   - Replaces `estimateRequiredMB(args)` with the refined formula from design §6.1
 *     (Reqs 6.1–6.9). The refined estimator accepts the extended input shape
 *     `{ modelFileSizeMB, totalLayers, ctxSize, typeK, typeV, purpose, nGpuLayers,
 *        nCpuMoe, isMoE, activeParamsB?, totalParamsB?, hiddenSizeBytesPerTokenPerLayer?,
 *        mmprojMB? }`. Missing MoE fields collapse to the dense case (Req 6.9) so
 *     phase-1-shaped callers that never populate MoE fields still produce a well-
 *     defined, non-negative result.
 *   - Extends `detect()` to also expose `gpuCount` (line count from nvidia-smi) and
 *     `physicalCores` (from `detectPhysicalCores`) so the settings UI and the
 *     autoTuneNgl / recommendPreset helpers do not need to probe the OS separately.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7 (phase-1); 6.1–6.9 (phase-2).
 */

const { execSync } = require('child_process');
const { kvPrecisionBytes, detectPhysicalCores } = require('./advanced-args');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const OS_OVERHEAD_MB = 512;

// Phase-2: per-process CUDA context, buffers, and llama.cpp scratch allocations.
// Added exactly once per estimate call (Req 6.6 / P50).
const PER_INSTANCE_OVERHEAD_MB = 256;

// Phase-2: vision-purpose mmproj overhead preserved at the phase-1 level so the
// legacy vision-overhead magnitude carries forward unchanged.
const MMPROJ_OVERHEAD_MB = 512;

// Phase-2: bytes per token per layer for the hidden state. 0.25 KiB = 256 bytes
// is the design-default covering typical 7B–35B models at head-dim 128 with
// 32 kv-heads (design §6.1). Callers can override via
// `args.hiddenSizeBytesPerTokenPerLayer` when real GGUF metadata is available.
const DEFAULT_HBYTES_PER_TOKEN_PER_LAYER = 256;

const BYTES_PER_MIB = 1024 * 1024;

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

/**
 * Estimate the MiB of "inactive" expert weights for an MoE model (glossary
 * "Inactive_Expert_Weight_MB" / design §6.2).
 *
 * Derives bytes-per-param from the quantised model file size divided by the
 * reported total parameter count, then multiplies by the inactive parameter
 * count (`totalParamsB - activeParamsB`). Returns `0` when either of
 * `totalParamsB` / `activeParamsB` is missing, non-finite, non-positive, or
 * when totalParamsB <= activeParamsB (nothing to subtract). Also returns `0`
 * when `modelFileSizeMB` is missing or non-positive (no size to divide).
 *
 * @param {{ modelFileSizeMB?: number, totalParamsB?: number, activeParamsB?: number }} args
 * @returns {number} non-negative MiB estimate
 */
function estimateInactiveExpertMB(args) {
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

/**
 * Refined VRAM estimate for a slot configuration (design §6.1, Reqs 6.1–6.9).
 *
 * Input shape:
 *   {
 *     modelFileSizeMB: number,  // total size of the GGUF file on disk (MiB)
 *     totalLayers:     number,  // positive integer; see inferTotalLayers
 *     ctxSize:         number,  // tokens
 *     typeK:           KvCacheType,  // defaults to 'f16' when missing
 *     typeV:           KvCacheType,  // defaults to 'f16' when missing
 *     purpose:         'primary'|'secondary'|'vision'|'embedding'|'coding',
 *     nGpuLayers:      number,  // -1 | 0..999 (default: -1 when missing)
 *     nCpuMoe:         number,  // 0..999
 *     isMoE:           boolean,
 *     activeParamsB?:  number,
 *     totalParamsB?:   number,
 *     hiddenSizeBytesPerTokenPerLayer?: number,  // optional GGUF-derived override
 *     mmprojMB?:       number,                   // override default vision overhead
 *   }
 *
 * Monotonicity guarantees (checked by P45/P46/P47/P48/P49/P50):
 *   - non-decreasing in `nGpuLayers`         (Req 6.7)
 *   - non-decreasing in `kvPrecisionBytes`   (Req 6.8)
 *   - non-increasing in `nCpuMoe` when isMoE (Req 6.5)
 *   - independent of `nCpuMoe` when !isMoE   (Req 6.9)
 *   - overhead contribution is exactly 256   (Req 6.6)
 *
 * @param {object} args - Configuration object (see above)
 * @returns {number} non-negative MiB
 */
function estimateRequiredMB(args) {
  // Input is defensively normalised so phase-1-shaped callers (which omit the
  // new MoE/KV/offload fields entirely) still produce a finite, non-negative
  // result. Defaults match design §6.1's documented semantics:
  //   - nGpuLayers missing  → -1   (delegate to server = full offload)
  //   - typeK/typeV missing → 'f16' (phase-1 baseline precision)
  //   - MoE fields missing  → dense path (Req 6.9)
  //   - hidden size missing → 256 bytes per token per layer
  //   - mmprojMB missing    → 512 for 'vision' purpose, else 0
  if (!args || typeof args !== 'object') {
    return PER_INSTANCE_OVERHEAD_MB;
  }

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
  // `-1` is the phase-2 sentinel meaning "delegate to server", which defaults
  // to full offload. Missing `nGpuLayers` is treated as `-1` so that phase-1
  // callers (which never populated the field) behave like the default user.
  const nGpuLayersRaw = Number.isFinite(args.nGpuLayers) ? args.nGpuLayers : -1;
  const nGplEffective = nGpuLayersRaw === -1 ? totalLayers : nGpuLayersRaw;
  const layersOffloaded = Math.max(0, Math.min(nGplEffective, totalLayers));

  // --- Model weight contribution (Req 6.3) -----------------------------------
  // Scales linearly with the fraction of layers offloaded. When nGpuLayers is
  // 0 (or totalLayers is 0), the contribution is exactly 0.
  const modelWeightContribution =
    totalLayers > 0 && modelFileSizeMB > 0
      ? modelFileSizeMB * (layersOffloaded / totalLayers)
      : 0;

  // --- KV cache contribution (Req 6.4) ---------------------------------------
  // The divisor `2 * 2 = 4` normalises the reference f16/f16 baseline to a
  // ratio factor of 1.0; every other precision combination scales linearly.
  const h =
    Number.isFinite(args.hiddenSizeBytesPerTokenPerLayer) &&
    args.hiddenSizeBytesPerTokenPerLayer >= 0
      ? args.hiddenSizeBytesPerTokenPerLayer
      : DEFAULT_HBYTES_PER_TOKEN_PER_LAYER;

  const typeK = typeof args.typeK === 'string' ? args.typeK : 'f16';
  const typeV = typeof args.typeV === 'string' ? args.typeV : 'f16';
  // kvPrecisionBytes is a total function that throws for unknown strings
  // (UnknownKvCacheTypeError). Validated inputs never hit that path; invalid
  // inputs are a programmer error and should surface loudly.
  const kvPrecisionFactor =
    (kvPrecisionBytes(typeK) + kvPrecisionBytes(typeV)) / 4;

  const kvCacheBytes = ctxSize * 2 * h * layersOffloaded * kvPrecisionFactor;
  const kvCacheMB = kvCacheBytes / BYTES_PER_MIB;

  // --- MoE inactive-expert subtraction (Reqs 6.5, 6.9) -----------------------
  // Clamped to the model-weight contribution so the running total cannot go
  // negative regardless of parameter-count metadata. When `isMoE` is false,
  // `nCpuMoe` has zero effect on the estimate (P49).
  let moeSubtractionMB = 0;
  if (
    args.isMoE === true &&
    Number.isFinite(args.nCpuMoe) &&
    args.nCpuMoe > 0 &&
    totalLayers > 0
  ) {
    const inactiveEstimateMB = estimateInactiveExpertMB(args);
    const fraction = args.nCpuMoe / totalLayers;
    moeSubtractionMB = Math.min(
      inactiveEstimateMB * fraction,
      modelWeightContribution
    );
  }

  // --- mmproj overhead (vision default preserved from phase-1) ---------------
  const mmprojMB =
    Number.isFinite(args.mmprojMB) && args.mmprojMB >= 0
      ? args.mmprojMB
      : args.purpose === 'vision'
        ? MMPROJ_OVERHEAD_MB
        : 0;

  // --- Total (Req 6.6: per-instance overhead added exactly once) -------------
  const total =
    Math.max(0, modelWeightContribution - moeSubtractionMB) +
    kvCacheMB +
    mmprojMB +
    PER_INSTANCE_OVERHEAD_MB;

  return Math.max(0, total);
}

/**
 * Check if a configuration can fit within the VRAM budget.
 *
 * Phase-1 behaviour preserved: detection-failure short-circuits to
 * `{ ok: true }` (Req 4.5); otherwise the feasibility predicate is
 * `activeTotal + estimateRequiredMB(config) + reservedMB <= totalMB`.
 *
 * @param {Object} config - Configuration object accepted by `estimateRequiredMB`
 * @param {Object} context - Context object with VRAM info and active allocations
 * @param {number} context.totalMB - Total VRAM in MiB
 * @param {number} context.reservedMB - Reserved VRAM in MiB
 * @param {number[]} context.activeAllocationsMB - Array of active allocations in MiB
 * @param {boolean} context.detected - Whether VRAM was successfully detected
 * @returns {Object} { ok: boolean, requiredMB?: number, candidates?: Slot[] }
 */
function canFit(config, context) {
  const { totalMB, reservedMB, activeAllocationsMB, detected } = context;

  // If VRAM detection failed, always allow (Req 4.5)
  if (!detected) {
    return { ok: true };
  }

  const requiredMB = estimateRequiredMB(config);
  const activeTotal = activeAllocationsMB.reduce((sum, mb) => sum + mb, 0);
  const needed = activeTotal + requiredMB + reservedMB;

  if (needed <= totalMB) {
    return { ok: true };
  }

  // Cannot fit - return eviction candidates
  // Note: candidates will be populated by the manager with actual Slot objects
  return {
    ok: false,
    requiredMB,
    candidates: [], // Will be populated by the manager
  };
}

/**
 * Rank eviction candidates by priority.
 *
 * Sorting criteria:
 * 1. Non-primary slots first (purpose != 'primary')
 * 2. Least recently used first (ascending lastUsed timestamp)
 *
 * @param {Array} activeSlots - Array of active Slot objects
 * @returns {Array} Sorted array of eviction candidates
 */
function rankEvictionCandidates(activeSlots) {
  return activeSlots.slice().sort((a, b) => {
    // Primary slots have lower priority for eviction (sort them last)
    const aPrimary = a.purpose === 'primary' ? 1 : 0;
    const bPrimary = b.purpose === 'primary' ? 1 : 0;

    if (aPrimary !== bPrimary) {
      return aPrimary - bPrimary; // Non-primary first (0 < 1)
    }

    // Within same priority, sort by lastUsed (ascending - least recently used first)
    const aTime = a.lastUsed ?? 0;
    const bTime = b.lastUsed ?? 0;
    return aTime - bTime;
  });
}

/**
 * Detect total VRAM available on the system plus the GPU count and physical
 * core count.
 *
 * Phase-1 behaviour (nvidia-smi first, then rocm-smi, then `detected: false`)
 * is preserved. Phase-2 additions:
 *   - `gpuCount`: the line count returned by
 *     `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`.
 *     `0` on detection failure; `1` when the probe returns a single row.
 *   - `physicalCores`: `detectPhysicalCores()` result. Populated on every
 *     detection outcome (OS-derived, independent of the GPU probe).
 *
 * @param {Function} [detector] - Optional detector function for testing
 * @returns {Promise<{detected: boolean, totalMB: number, reservedMB: number, gpuCount: number, physicalCores: number}>}
 */
async function detectVram(detector) {
  const physicalCores = detectPhysicalCores();

  if (detector) {
    const result = await detector();
    // Fill in phase-2 fields if the injected detector omitted them so test
    // detectors written against the phase-1 shape continue to work.
    return {
      detected: result.detected === true,
      totalMB: Number.isFinite(result.totalMB) ? result.totalMB : 0,
      reservedMB: Number.isFinite(result.reservedMB) ? result.reservedMB : OS_OVERHEAD_MB,
      gpuCount: Number.isFinite(result.gpuCount)
        ? result.gpuCount
        : result.detected === true
          ? 1
          : 0,
      physicalCores: Number.isFinite(result.physicalCores) ? result.physicalCores : physicalCores,
    };
  }

  // Try nvidia-smi
  try {
    const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
    const totalMB = parseInt(lines[0], 10);
    if (!isNaN(totalMB)) {
      // gpuCount is the number of rows nvidia-smi returned (1 = single GPU).
      return {
        detected: true,
        totalMB,
        reservedMB: OS_OVERHEAD_MB,
        gpuCount: lines.length,
        physicalCores,
      };
    }
  } catch (_e) {
    // nvidia-smi not available or failed
  }

  // Try rocm-smi
  try {
    const output = execSync('rocm-smi --showmeminfo', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    // Parse rocm-smi output to find total memory
    // Format varies, but typically contains "Total Memory" or similar
    const match = output.match(/Total Memory.*?(\d+)\s*MB/i);
    if (match) {
      const totalMB = parseInt(match[1], 10);
      if (!isNaN(totalMB)) {
        return {
          detected: true,
          totalMB,
          reservedMB: OS_OVERHEAD_MB,
          gpuCount: 1,
          physicalCores,
        };
      }
    }
  } catch (_e) {
    // rocm-smi not available or failed
  }

  // Detection failed
  return {
    detected: false,
    totalMB: 0,
    reservedMB: OS_OVERHEAD_MB,
    gpuCount: 0,
    physicalCores,
  };
}

/**
 * VramBudgetManager class
 *
 * Manages VRAM budget across multiple slots.
 */
class VramBudgetManager {
  constructor({ detector = null } = {}) {
    this.detector = detector;
    this.detectionResult = null;
    this.allocations = new Map(); // slotId -> MB
    this.detectionWarningLogged = false;
  }

  /**
   * Detect total VRAM and cache the result.
   *
   * @returns {Promise<Object>} Detection result
   */
  async detect() {
    this.detectionResult = await detectVram(this.detector);

    // Log one-time warning if detection failed (Req 4.5)
    if (!this.detectionResult.detected && !this.detectionWarningLogged) {
      console.warn(
        'VRAM detection failed. GPU memory budget enforcement is disabled. ' +
          'Ensure nvidia-smi or rocm-smi is available.'
      );
      this.detectionWarningLogged = true;
    }

    return this.detectionResult;
  }

  /**
   * Check if a configuration can fit within the VRAM budget.
   *
   * @param {Object} config - Configuration object
   * @param {Object} context - Context object (optional, uses cached detection if not provided)
   * @returns {Object} { ok: boolean, requiredMB?: number, candidates?: Slot[] }
   */
  canFit(config, context) {
    const ctx = context || this.detectionResult || {
      detected: false,
      totalMB: 0,
      reservedMB: OS_OVERHEAD_MB,
      gpuCount: 0,
      physicalCores: detectPhysicalCores(),
    };

    const activeAllocationsMB = Array.from(this.allocations.values());
    const fullContext = {
      ...ctx,
      activeAllocationsMB,
    };

    return canFit(config, fullContext);
  }

  /**
   * Estimate required VRAM for a configuration.
   *
   * @param {Object} config - Configuration object
   * @returns {number} Estimated required VRAM in MiB
   */
  estimateRequiredMB(config) {
    return estimateRequiredMB(config);
  }

  /**
   * Rank eviction candidates.
   *
   * @param {Array} activeSlots - Array of active Slot objects
   * @returns {Array} Sorted array of eviction candidates
   */
  rankEvictionCandidates(activeSlots) {
    return rankEvictionCandidates(activeSlots);
  }

  /**
   * Register a VRAM allocation for a slot.
   *
   * @param {number} slotId - Slot ID
   * @param {number} mb - Allocated VRAM in MiB
   */
  registerAllocation(slotId, mb) {
    this.allocations.set(slotId, mb);
  }

  /**
   * Release a VRAM allocation for a slot.
   *
   * @param {number} slotId - Slot ID
   */
  releaseAllocation(slotId) {
    this.allocations.delete(slotId);
  }
}

// Export the class and pure helper functions
module.exports = {
  VramBudgetManager,
  canFit,
  estimateRequiredMB,
  estimateInactiveExpertMB,
  rankEvictionCandidates,
  detectVram,
  PER_INSTANCE_OVERHEAD_MB,
};
