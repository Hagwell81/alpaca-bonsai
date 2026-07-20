/**
 * Fast-check arbitraries for the extended VRAM Budget shape.
 *
 * The Budget shape mirrors what `VramBudgetManager.detect()` exposes after the
 * memory-tuning extension (design §6) and what `autoTuneNgl` /
 * `recommendPreset` consume (design §4, §5):
 *
 *     {
 *       detected:       boolean,
 *       totalVramMB:    number,   // 0 when detected === false
 *       reservedMB:     number,   // OS overhead; phase-1 default 512
 *       gpuCount:       number,   // 0 when detected === false; else >= 1
 *       physicalCores:  number,   // from detectPhysicalCores; clamp [1, 256]
 *     }
 *
 * `physicalCores` is OS-derived and therefore independent of GPU detection —
 * it is populated even when `detected === false`.
 *
 * Coverage (per task 2.3 sub-bullet and design §7 Testing Strategy):
 *   - detection failure (`detected === false`)
 *   - single-GPU small  (`totalVramMB <  12 GiB`)
 *   - single-GPU large  (`totalVramMB >= 12 GiB`)
 *   - multi-GPU
 *
 * 12 GiB = 12288 MiB is the KV-precision boundary used by P64 (Req 9.3).
 *
 * Supports: P51, P57, P61, P63, P64.
 */

const fc = require('fast-check');

// KV-precision boundary (Req 9.3 / P64): 12 GiB expressed in MiB.
const TWELVE_GIB_MB = 12 * 1024;

// Phase-1 OS overhead constant (`VramBudgetManager.OS_OVERHEAD_MB`).
const DEFAULT_RESERVED_MB = 512;

// `detectPhysicalCores` clamps the OS probe to [1, 256] with a fallback of 4.
const arbPhysicalCores = fc.integer({ min: 1, max: 256 });

/**
 * Detection failed: `totalVramMB` and `gpuCount` are `0`; `physicalCores`
 * remains a valid positive integer because it comes from the OS, not the GPU.
 *
 * Exercises the permissive-fallback branch of `autoTuneNgl` (Req 7.8) and the
 * `budget.gpuCount === 0` UI path (Req 5.5).
 */
const arbBudgetDetectionFailure = fc.record({
  detected: fc.constant(false),
  totalVramMB: fc.constant(0),
  reservedMB: fc.constant(DEFAULT_RESERVED_MB),
  gpuCount: fc.constant(0),
  physicalCores: arbPhysicalCores,
});

/**
 * Single GPU with strictly less than 12 GiB of VRAM.
 *
 * Exercises the `typeK === 'q8_0' / typeV === 'q8_0'` branch of
 * `recommendPreset` (Req 9.3, P64) and the constrained-fit branch of
 * `autoTuneNgl` (P51).
 */
const arbBudgetSingleGpuSmall = fc.record({
  detected: fc.constant(true),
  totalVramMB: fc.integer({ min: 1024, max: TWELVE_GIB_MB - 1 }),
  reservedMB: fc.constant(DEFAULT_RESERVED_MB),
  gpuCount: fc.constant(1),
  physicalCores: arbPhysicalCores,
});

/**
 * Single GPU with 12 GiB or more of VRAM.
 *
 * Exercises the `typeK === 'f16' / typeV === 'f16'` branch of
 * `recommendPreset` (Req 9.3, P64).
 */
const arbBudgetSingleGpuLarge = fc.record({
  detected: fc.constant(true),
  // Upper bound = 96 GiB — covers H100-class single cards without letting
  // generated values explode the search space.
  totalVramMB: fc.integer({ min: TWELVE_GIB_MB, max: 96 * 1024 }),
  reservedMB: fc.constant(DEFAULT_RESERVED_MB),
  gpuCount: fc.constant(1),
  physicalCores: arbPhysicalCores,
});

/**
 * Multi-GPU setup.
 *
 * Exercises the `splitMode = 'layer'` branch of `recommendPreset` (Req 9.8)
 * and the `visibleDevices` UI visibility rule (Req 5.5).
 */
const arbBudgetMultiGpu = fc.record({
  detected: fc.constant(true),
  // Aggregated VRAM across 2–8 GPUs; range kept well below Number.MAX_SAFE_INTEGER.
  totalVramMB: fc.integer({ min: 8 * 1024, max: 192 * 1024 }),
  reservedMB: fc.constant(DEFAULT_RESERVED_MB),
  gpuCount: fc.integer({ min: 2, max: 8 }),
  physicalCores: arbPhysicalCores,
});

/**
 * Unified Budget arbitrary: samples uniformly from the four shape-specific
 * arbitraries above.
 */
const arbBudget = fc.oneof(
  arbBudgetDetectionFailure,
  arbBudgetSingleGpuSmall,
  arbBudgetSingleGpuLarge,
  arbBudgetMultiGpu,
);

module.exports = {
  TWELVE_GIB_MB,
  DEFAULT_RESERVED_MB,
  arbPhysicalCores,
  arbBudgetDetectionFailure,
  arbBudgetSingleGpuSmall,
  arbBudgetSingleGpuLarge,
  arbBudgetMultiGpu,
  arbBudget,
};
