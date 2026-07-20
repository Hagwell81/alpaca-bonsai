/**
 * Slot Args Builder
 *
 * Pure function that constructs llama-server argv from a SlotConfig.
 * Implements the flag contribution table from the design document.
 *
 * Phase-1 requirements: 9.2, 9.3, 9.4, 9.5, 10.2, 10.3, 10.4, 10.5, 10.6, 12.2, 16.2
 *
 * Phase-2 (llama-cpp-memory-tuning) additive extensions (design §2 flag table):
 *   - `-t <threads>` (always, after the mlock block)                       Req 4.3
 *   - `-ngl <nGpuLayers>` when nGpuLayers >= 0                             Req 1.2, 1.3, 1.4
 *   - `--type-k <typeK>` when typeK !== 'f16'                              Req 2.2
 *   - `--type-v <typeV>` when typeV !== 'f16'                              Req 2.2
 *   - `--n-cpu-moe <nCpuMoe>` when nCpuMoe > 0                             Req 3.2, 3.3
 *
 * Phase-3 (mtp-turboquant-presets) additive extensions:
 *   - speculative mode support: 'draft-model' | 'mtp' | 'eagle3' | 'ngram' | 'ngram-simple'
 *     --speculative, --speculative-n-max, --speculative-n-min, --speculative-p-min
 *   - TurboQuant type gating via optional backendFeatures parameter
 */

const { TURBOQUANT_TYPES } = require('./advanced-args');

/**
 * Resolve the effective KV cache type, downgrading TurboQuant types when the
 * backend does not support them.
 *
 * @param {string} typeName
 * @param {{ turboQuant?: boolean }|null|undefined} backendFeatures
 * @returns {string}
 */
function resolveKvType(typeName, backendFeatures) {
  if (!typeName || typeof typeName !== 'string') return 'f16';
  if (!TURBOQUANT_TYPES.has(typeName)) return typeName;

  // TurboQuant type requested.
  const supported =
    backendFeatures &&
    typeof backendFeatures === 'object' &&
    backendFeatures.turboQuant === true;

  if (supported) return typeName;

  // Downgrade to the nearest standard type.
  if (typeName === 'turbo2_0') return 'q4_0';
  if (typeName === 'turbo3_0') return 'q4_0';
  if (typeName === 'turbo4_0') return 'q5_0';
  return 'f16';
}

/**
 * Build llama-server argv from a SlotConfig
 *
 * Constructs a deterministic argv array for spawning llama-server with the given configuration.
 * Output always begins with ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port)].
 * Flags are emitted in a fixed order for determinism.
 *
 * Flag contribution table (design §2, phase-2 + phase-3 extension):
 * - flashAttn == true: ['--flash-attn']
 * - mmap == false: ['--no-mmap'] (no flag when true)
 * - mlock == true: ['--mlock']
 * - threads (always): ['-t', String(threads)]                              (Phase-2, Req 4.3)
 * - ctxSize: ['-c', String(ctxSize)]
 * - batchSize: ['-b', String(batchSize)]
 * - ubatchSize: ['-ub', String(ubatchSize)]
 * - parallel: ['-np', String(parallel)]
 * - nGpuLayers >= 0: ['-ngl', String(nGpuLayers)]                          (Phase-2, Req 1.2)
 * - typeK !== 'f16': ['--type-k', String(typeK)]                           (Phase-2, Req 2.2)
 * - typeV !== 'f16': ['--type-v', String(typeV)]                           (Phase-2, Req 2.2)
 * - nCpuMoe > 0: ['--n-cpu-moe', String(nCpuMoe)]                          (Phase-2, Req 3.2)
 * - tensorSplit.length > 0: ['--tensor-split', tensorSplit.join(',')]
 * - mainGpu >= 0: ['--main-gpu', String(mainGpu)]
 * - splitMode: ['--split-mode', splitMode]
 * - rpc.length > 0: ['--rpc', rpc.join(',')]
 * - contBatching == true: ['--cont-batching']
 * - contBatching == false: ['--no-cont-batching']
 * - speculative.enabled + mode == 'draft-model': ['-md', draftModel, '-cd', String(draftCtxSize)]
 * - speculative.enabled + mode != 'draft-model': ['--speculative', '--speculative-n-max', ...]
 * - purpose == 'embedding': ['--embedding', '--pooling', 'mean']
 * - mmprojPath != null: ['--mmproj', mmprojPath]
 *
 * @param {Object} slotConfig - The slot configuration
 * @param {string} slotConfig.modelPath - Absolute path to the GGUF model
 * @param {string|null} slotConfig.mmprojPath - Absolute path to mmproj (optional)
 * @param {number} slotConfig.port - Port number for the slot
 * @param {string} slotConfig.purpose - Slot purpose ('primary', 'secondary', 'vision', 'embedding', 'coding')
 * @param {Object} slotConfig.advancedArgs - Advanced arguments object
 * @param {{ turboQuant?: boolean }|null|undefined} [backendFeatures] - Optional backend capability probe results
 * @returns {string[]} argv array for spawning llama-server
 */
function buildArgs(slotConfig, backendFeatures) {
  const { modelPath, mmprojPath, port, purpose, advancedArgs } = slotConfig;

  // Resolve KV types (downgrade TurboQuant if backend lacks support)
  const effectiveTypeK = resolveKvType(advancedArgs.typeK, backendFeatures);
  const effectiveTypeV = resolveKvType(advancedArgs.typeV, backendFeatures);

  // Start with base arguments
  const argv = [
    '--model', modelPath,
    '--host', '127.0.0.1',
    '--port', String(port),
  ];

  // Performance / memory flags (Req 9)
  if (advancedArgs.flashAttn) {
    argv.push('--flash-attn');
  }

  if (!advancedArgs.mmap) {
    argv.push('--no-mmap');
  }

  if (advancedArgs.mlock) {
    argv.push('--mlock');
  }

  // Phase-2: thread pinning (Req 4.3). Inserted after the mlock block
  // because `-t` is a host-side CPU knob semantically paired with
  // mmap/mlock rather than with GPU tuning. Always emitted exactly once.
  argv.push('-t', String(advancedArgs.threads));

  // Context and batch sizes (Req 9.5)
  argv.push('-c', String(advancedArgs.ctxSize));
  argv.push('-b', String(advancedArgs.batchSize));
  argv.push('-ub', String(advancedArgs.ubatchSize));
  argv.push('-np', String(advancedArgs.parallel));

  // Phase-2: offload / KV-precision block (design §2 rows 10-13).
  // Placed after `-np` and before the multi-GPU distribution flags so
  // "compute layout first, inter-GPU distribution second" holds.

  // `-ngl <nGpuLayers>` only when nGpuLayers >= 0 (Req 1.2);
  // `-1` means "let llama-server decide" and MUST NOT emit the flag
  // (Req 1.3). `--n-gpu-layers` / `--gpu-layers` are never emitted.
  if (advancedArgs.nGpuLayers >= 0) {
    argv.push('-ngl', String(advancedArgs.nGpuLayers));
  }

  // `--type-k <typeK>` only when typeK !== 'f16' (Req 2.2). f16 is the
  // upstream default; omitting the flag keeps argv minimal, matching the
  // phase-1 convention for `mmap`.
  if (effectiveTypeK !== 'f16') {
    argv.push('--type-k', String(effectiveTypeK));
  }

  // `--type-v <typeV>` only when typeV !== 'f16' (Req 2.2).
  if (effectiveTypeV !== 'f16') {
    argv.push('--type-v', String(effectiveTypeV));
  }

  // `--n-cpu-moe <nCpuMoe>` only when nCpuMoe > 0 (Req 3.2); `0` means
  // "do not set the flag" (Req 3.3).
  if (advancedArgs.nCpuMoe > 0) {
    argv.push('--n-cpu-moe', String(advancedArgs.nCpuMoe));
  }

  // Multi-GPU / distributed flags (Req 10)
  if (advancedArgs.tensorSplit && advancedArgs.tensorSplit.length > 0) {
    argv.push('--tensor-split', advancedArgs.tensorSplit.join(','));
  }

  if (advancedArgs.mainGpu >= 0) {
    argv.push('--main-gpu', String(advancedArgs.mainGpu));
  }

  if (advancedArgs.splitMode) {
    argv.push('--split-mode', advancedArgs.splitMode);
  }

  if (advancedArgs.rpc && advancedArgs.rpc.length > 0) {
    argv.push('--rpc', advancedArgs.rpc.join(','));
  }

  // Continuous batching (Req 10.6)
  if (advancedArgs.contBatching) {
    argv.push('--cont-batching');
  } else {
    argv.push('--no-cont-batching');
  }

  // Speculative decoding (Phase-3 extended)
  const spec = advancedArgs.speculative;
  if (spec && spec.enabled && spec.mode !== 'off') {
    if (spec.mode === 'draft-model') {
      // External draft model (legacy phase-1 path)
      if (spec.draftModel) {
        argv.push('-md', spec.draftModel);
        argv.push('-cd', String(spec.draftCtxSize));
      }
    } else {
      // Internal speculative modes: MTP, Eagle3, ngram
      // Only emit --speculative and related params if the backend supports them.
      const hasSpecFlags =
        backendFeatures &&
        typeof backendFeatures === 'object' &&
        backendFeatures.speculative === true;

      if (hasSpecFlags) {
        argv.push('--speculative');
        argv.push('--speculative-n-max', String(spec.nMax));
        argv.push('--speculative-n-min', String(spec.nMin));
        argv.push('--speculative-p-min', String(spec.pMin));
      }
      // If the backend does not expose speculative flags, gracefully degrade
      // to non-speculative inference rather than crashing on an unknown flag.
    }
  }

  // Embedding slot special handling (Req 16.2)
  if (purpose === 'embedding') {
    argv.push('--embedding');
    argv.push('--pooling', 'mean');
  }

  // Vision projection (legacy behavior)
  if (mmprojPath) {
    argv.push('--mmproj', mmprojPath);
  }

  return argv;
}

module.exports = {
  buildArgs,
  resolveKvType,
};
