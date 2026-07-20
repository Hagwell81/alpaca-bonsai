/**
 * @fileoverview Model-specific preset database for optimal inference configuration.
 *
 * Provides per-model-architecture overrides that sit on top of the generic
 * dense-small / dense-large / moe-small / moe-large classification.
 * Each entry maps a canonical model family name to recommended Advanced_Args
 * overrides (KV precision, flash-attn, context size, speculative mode, etc.).
 *
 * The database is keyed by lower-case GGUF architecture values and filename
 * heuristics so it works both when full metadata is available and when we
 * only have the filename.
 *
 * Exposes:
 *   - `lookupPreset(modelMeta)` -> `{ overrides: object|null, confidence: 'exact'|'architecture'|'filename'|'none' }`
 *   - `MODEL_PRESETS` — the raw database (frozen)
 *   - `ARCHITECTURE_PRESETS` — architecture → preset map
 *   - `FILENAME_PATTERNS` — RegExp[] with attached preset names
 *
 * Purity contract: no I/O, no process spawns, no network, no clock, no env.
 */

'use strict';

/**
 * @typedef {Object} ModelPreset
 * @property {string} name Human-readable model family name.
 * @property {string} [architecture] GGUF general.architecture value (lower-case).
 * @property {RegExp[]} filenamePatterns RegExps that match GGUF filenames.
 * @property {Object} overrides Partial Advanced_Args overrides.
 * @property {string} [description] Why these overrides are recommended.
 */

/**
 * Database of known model families with tuned inference settings.
 *
 * Design principles:
 *   1. Large models (>13B dense, >30B MoE) get aggressive KV compression
 *      because their KV cache dominates VRAM at long context.
 *   2. MoE models get `--n-cpu-moe` recommendations based on active vs total
 *      parameter ratios so inactive experts can live in system RAM.
 *   3. Models with built-in MTP heads (Qwen3 family, GPT-OSS) enable MTP
 *      speculative decoding automatically.
 *   4. Flash Attention is always recommended for GPU-backed inference.
 */

/** @type {Record<string, ModelPreset>} */
const MODEL_PRESETS = Object.freeze({
  // ── Ternary Bonsai family (1.58-bit ternary LLMs) ──────────────────────────
  // Flags sourced from the Bonsai-demo project scripts/run_llama.sh and
  // scripts/start_llama_server.sh. All sizes use -ngl 99 -fa on -c 0 (auto).
  // The 27B has vision + tool calling; smaller models disable thinking.
  bonsai_27b: {
    name: 'Ternary Bonsai 27B',
    architecture: 'qwen3',
    filenamePatterns: [
      /ternary[-_]?bonsai[-_]?27[bB]/i,
      /bonsai[-_]?27[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 0,           // auto-fit to available memory
      typeK: 'f16',
      typeV: 'f16',
      // Sampling defaults from Bonsai-demo (27B uses more creative sampling)
      sampling: {
        temp: 0.7,
        topP: 0.95,
        topK: 20,
        minP: 0,
      },
      // 27B supports native tool calling via Jinja templates
      jinja: true,
      // ── Experimental features (opt-in, see Bonsai-demo KV-CACHE.md & SPECULATIVE.md) ──
      // 4-bit KV cache: ~3.5x smaller KV memory at the cost of slightly slower
      // decode. Only useful at very long contexts on tight machines.
      // When enabled: passes --cache-type-k q4_0 --cache-type-v q4_0
      // Auto-detects *-kv-bias*.gguf for mean-centering quality boost.
      kv4: false,           // opt-in via UI toggle
      // Speculative decoding with dspark drafter: ~1.8-2x faster decode on CUDA
      // for code/reasoning workloads. Requires the dspark drafter GGUF.
      // When enabled: passes -md <drafter> --spec-type draft-dspark
      //   --spec-draft-n-max 4 -ngld 999 -np 1 -c 16384
      // Trade-offs: disables cross-request prompt-cache reuse, forces single slot.
      // CUDA only — not recommended on Metal/Vulkan/CPU.
      speculative: {
        enabled: false,     // opt-in via UI toggle
        mode: 'draft-dspark',
        nMax: 4,            // must match drafter's block_size
        ngld: 999,          // offload all drafter layers to GPU
        ctxSize: 16384,     // increased context for speculation
        parallel: 1,        // forced single slot
      },
    },
    description:
      'Ternary Bonsai 27B (Q2_0, 1.58-bit). Flash attention + auto context. Supports vision (--mmproj) and tool calling (--jinja). Sampling: temp=0.7, top-p=0.95, top-k=20. Experimental: 4-bit KV cache (kv4) and dspark speculative decoding (speculative).',
  },

  bonsai_8b: {
    name: 'Ternary Bonsai 8B',
    architecture: 'qwen3',
    filenamePatterns: [
      /ternary[-_]?bonsai[-_]?8[bB]/i,
      /bonsai[-_]?8[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 0,           // auto-fit to available memory
      typeK: 'f16',
      typeV: 'f16',
      // Smaller models use less creative sampling and disable thinking
      sampling: {
        temp: 0.5,
        topP: 0.85,
        topK: 20,
        minP: 0,
      },
      // Disable reasoning/thinking mode for smaller models
      reasoningBudget: 0,
      reasoningFormat: 'none',
    },
    description:
      'Ternary Bonsai 8B (Q2_0, 1.58-bit). Flash attention + auto context. Thinking disabled (--reasoning-budget 0). Sampling: temp=0.5, top-p=0.85, top-k=20.',
  },

  bonsai_4b: {
    name: 'Ternary Bonsai 4B',
    architecture: 'qwen3',
    filenamePatterns: [
      /ternary[-_]?bonsai[-_]?4[bB]/i,
      /bonsai[-_]?4[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 0,           // auto-fit to available memory
      typeK: 'f16',
      typeV: 'f16',
      sampling: {
        temp: 0.5,
        topP: 0.85,
        topK: 20,
        minP: 0,
      },
      reasoningBudget: 0,
      reasoningFormat: 'none',
    },
    description:
      'Ternary Bonsai 4B (Q2_0, 1.58-bit). Flash attention + auto context. Thinking disabled. Same sampling as 8B.',
  },

  // ── Qwen3 family (Dense + MTP heads) ──────────────────────────────────────
  qwen3_27b: {
    name: 'Qwen3 27B',
    architecture: 'qwen3',
    filenamePatterns: [/(?:^|[\-_])qwen3[_\-]?\.?27[bB]/],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
      speculative: {
        enabled: true,
        mode: 'mtp',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 4,
        nMin: 2,
        pMin: 0.75,
      },
    },
    description:
      'Dense 27B with MTP heads. q5_0 KV keeps VRAM under ~18 GiB at 8K ctx. MTP nMax=4 gives ~15-25% decode speedup.',
  },

  qwen3_35b_a3b: {
    name: 'Qwen3.6-35B-A3B (MoE)',
    architecture: 'qwen2_moe',
    filenamePatterns: [
      /(?:^|[\-_])qwen3\.?6[_\-]?35[bB][-_]?a3[bB]/i,
      /(?:^|[\-_])qwen3[_\-]?35[bB][-_]?a3[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
      nCpuMoe: 4,
      speculative: {
        enabled: true,
        mode: 'mtp',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 4,
        nMin: 2,
        pMin: 0.75,
      },
    },
    description:
      'MoE with 35B total / 3B active params. q5_0 KV + 4 CPU-routed MoE layers fits in ~16-20 GiB. MTP enabled via model heads.',
  },

  qwen3_9b: {
    name: 'Qwen3 9B',
    architecture: 'qwen3',
    filenamePatterns: [/(?:^|[\-_])qwen3[_\-]?\.?9[bB]/],
    overrides: {
      flashAttn: true,
      ctxSize: 16384,
      typeK: 'q8_0',
      typeV: 'q8_0',
      speculative: {
        enabled: true,
        mode: 'mtp',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 4,
        nMin: 2,
        pMin: 0.75,
      },
    },
    description:
      'Mid-size dense with MTP. q8_0 KV preserves quality while still halving KV VRAM.',
  },

  qwen3_4b: {
    name: 'Qwen3 4B',
    architecture: 'qwen3',
    filenamePatterns: [/(?:^|[\-_])qwen3[_\-]?\.?4[bB]/],
    overrides: {
      flashAttn: true,
      ctxSize: 32768,
      typeK: 'f16',
      typeV: 'f16',
      speculative: {
        enabled: true,
        mode: 'mtp',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 4,
        nMin: 2,
        pMin: 0.75,
      },
    },
    description:
      'Small dense with MTP. f16 KV is fine for this size; long context (32K) is the priority.',
  },

  // ── GPT-OSS family (Dense + MTP) ────────────────────────────────────────────
  gpt_oss_20b: {
    name: 'GPT-OSS 20B',
    architecture: 'gpt-oss',
    filenamePatterns: [/(?:^|[\-_])gpt[-_]?oss[-_]?20[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
      speculative: {
        enabled: true,
        mode: 'mtp',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 4,
        nMin: 2,
        pMin: 0.75,
      },
    },
    description:
      '20B dense with built-in MTP heads. q5_0 KV recommended for consumer VRAM efficiency.',
  },

  // ── Llama 3.x family ──────────────────────────────────────────────────────
  llama3_70b: {
    name: 'Llama 3 70B',
    architecture: 'llama',
    filenamePatterns: [
      /(?:^|[\-_])llama[-_]?3[-_]?70[bB]/i,
      /(?:^|[\-_])llama[-_]?3\.?3[-_]?70[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 4096,
      typeK: 'q4_0',
      typeV: 'q4_0',
    },
    description:
      'Large dense. q4_0 KV is essential to fit 70B weights + context into consumer VRAM.',
  },

  llama3_8b: {
    name: 'Llama 3 8B',
    architecture: 'llama',
    filenamePatterns: [
      /(?:^|[\-_])llama[-_]?3[-_]?8[bB]/i,
      /(?:^|[\-_])llama[-_]?3\.?1[-_]?8[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 16384,
      typeK: 'q8_0',
      typeV: 'q8_0',
    },
    description:
      'Small dense. q8_0 KV strikes a good balance for this size class.',
  },

  // ── Mixtral / Mistral family ──────────────────────────────────────────────
  mixtral_8x22b: {
    name: 'Mixtral 8x22B',
    architecture: 'mixtral',
    filenamePatterns: [/(?:^|[\-_])mixtral[-_]?8x22[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 4096,
      typeK: 'q4_0',
      typeV: 'q4_0',
      nCpuMoe: 6,
    },
    description:
      'Large MoE. Aggressive KV + heavy CPU MoE offload required for consumer GPUs.',
  },

  mixtral_8x7b: {
    name: 'Mixtral 8x7B',
    architecture: 'mixtral',
    filenamePatterns: [/(?:^|[\-_])mixtral[-_]?8x7[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
      nCpuMoe: 2,
    },
    description:
      'Mid-size MoE. q5_0 KV with light CPU MoE offload fits comfortably in 16-20 GiB.',
  },

  mistral_7b: {
    name: 'Mistral 7B',
    architecture: 'llama',
    filenamePatterns: [
      /(?:^|[\-_])mistral[-_]?7[bB]/i,
      /(?:^|[\-_])mistral[-_]?v?0\.?2[-_]?7[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 32768,
      typeK: 'q8_0',
      typeV: 'q8_0',
    },
    description:
      'Dense 7B with 32K sliding-window attention. q8_0 KV keeps long-context viable.',
  },

  // ── DeepSeek family ───────────────────────────────────────────────────────
  deepseek_v3: {
    name: 'DeepSeek-V3',
    architecture: 'deepseek2',
    filenamePatterns: [
      /(?:^|[\-_])deepseek[-_]?v3/i,
      /(?:^|[\-_])deepseek[-_]?moe[-_]?236[bB]/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 4096,
      typeK: 'q4_0',
      typeV: 'q4_0',
      nCpuMoe: 8,
    },
    description:
      'Very large MoE. Maximal KV compression + heavy CPU offload to fit in consumer VRAM.',
  },

  deepseek_r1: {
    name: 'DeepSeek-R1',
    architecture: 'deepseek2',
    filenamePatterns: [
      /(?:^|[\-_])deepseek[-_]?r1/i,
      /(?:^|[\-_])deepseek[-_]?r1[-_]?distill/i,
    ],
    overrides: {
      flashAttn: true,
      ctxSize: 4096,
      typeK: 'q4_0',
      typeV: 'q4_0',
      nCpuMoe: 8,
    },
    description:
      'Reasoning-specialised MoE. Same compression strategy as DeepSeek-V3.',
  },

  // ── Phi family ────────────────────────────────────────────────────────────
  phi4: {
    name: 'Phi-4',
    architecture: 'phi4',
    filenamePatterns: [/(?:^|[\-_])phi[-_]?4/i],
    overrides: {
      flashAttn: true,
      ctxSize: 16384,
      typeK: 'q8_0',
      typeV: 'q8_0',
    },
    description:
      'Dense 14B. q8_0 KV is a good default for this quality-conscious mid-size model.',
  },

  phi3: {
    name: 'Phi-3',
    architecture: 'phi3',
    filenamePatterns: [/(?:^|[\-_])phi[-_]?3/i],
    overrides: {
      flashAttn: true,
      ctxSize: 32768,
      typeK: 'f16',
      typeV: 'f16',
    },
    description:
      'Small dense (3.8B). f16 KV is fine; long context is the selling point.',
  },

  // ── Gemma family ─────────────────────────────────────────────────────────
  gemma3_27b: {
    name: 'Gemma 3 27B',
    architecture: 'gemma3',
    filenamePatterns: [/(?:^|[\-_])gemma[-_]?3[-_]?27[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
    },
    description:
      'Dense 27B with vision. q5_0 KV for VRAM efficiency.',
  },

  gemma3_4b: {
    name: 'Gemma 3 4B',
    architecture: 'gemma3',
    filenamePatterns: [/(?:^|[\-_])gemma[-_]?3[-_]?4[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 32768,
      typeK: 'f16',
      typeV: 'f16',
    },
    description:
      'Small vision-capable dense. f16 KV default.',
  },

  // ── Qwen2 family (pre-MTP) ────────────────────────────────────────────────
  qwen2_72b: {
    name: 'Qwen2 72B',
    architecture: 'qwen2',
    filenamePatterns: [/(?:^|[\-_])qwen2[-_]?72[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 4096,
      typeK: 'q4_0',
      typeV: 'q4_0',
    },
    description:
      'Large dense. q4_0 KV is essential to fit into consumer VRAM.',
  },

  qwen2_7b: {
    name: 'Qwen2 7B',
    architecture: 'qwen2',
    filenamePatterns: [/(?:^|[\-_])qwen2[-_]?7[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 32768,
      typeK: 'q8_0',
      typeV: 'q8_0',
    },
    description:
      'Mid-size dense. q8_0 KV for quality-conscious users.',
  },

  // ── Command R family ──────────────────────────────────────────────────────
  command_r_plus: {
    name: 'Command R+',
    architecture: 'cohere2',
    filenamePatterns: [/(?:^|[\-_])command[-_]?r[-_]?plus/i],
    overrides: {
      flashAttn: true,
      ctxSize: 8192,
      typeK: 'q5_0',
      typeV: 'q5_0',
    },
    description:
      'Dense 104B. q5_0 KV helps tame the enormous KV cache at long context.',
  },

  // ── Falcon family ─────────────────────────────────────────────────────────
  falcon_180b: {
    name: 'Falcon 180B',
    architecture: 'falcon',
    filenamePatterns: [/(?:^|[\-_])falcon[-_]?180[bB]/i],
    overrides: {
      flashAttn: true,
      ctxSize: 2048,
      typeK: 'q4_0',
      typeV: 'q4_0',
    },
    description:
      'Extremely large dense. q4_0 KV and short context are required for consumer GPUs.',
  },
});

// Build reverse lookup maps for fast matching.

/** @type {Map<string, string>} architecture -> presetKey */
const ARCHITECTURE_MAP = new Map();
/** @type {Array<{pattern: RegExp, key: string}>} */
const FILENAME_PATTERNS = [];

for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
  if (preset.architecture) {
    ARCHITECTURE_MAP.set(preset.architecture.toLowerCase(), key);
  }
  for (const pattern of preset.filenamePatterns) {
    FILENAME_PATTERNS.push({ pattern, key });
  }
}

Object.freeze(ARCHITECTURE_MAP);
Object.freeze(FILENAME_PATTERNS);

/**
 * Look up a model-specific preset from metadata.
 *
 * Confidence levels:
 *   - 'exact'    : matched by both architecture and filename (highest confidence)
 *   - 'architecture' : matched by GGUF architecture field only
 *   - 'filename' : matched by filename heuristic only
 *   - 'none'     : no match
 *
 * @param {ModelMeta|null|undefined} modelMeta
 * @returns {{ overrides: object|null, confidence: 'exact'|'architecture'|'filename'|'none', presetKey: string|null, name: string|null }}
 */
function lookupPreset(modelMeta) {
  const meta = (modelMeta !== null && typeof modelMeta === 'object') ? modelMeta : {};

  const filename =
    typeof meta.filename === 'string' && meta.filename.length > 0
      ? meta.filename
      : null;

  const architecture =
    typeof meta.architecture === 'string' && meta.architecture.length > 0
      ? meta.architecture.toLowerCase()
      : null;

  // Try architecture match first.
  if (architecture) {
    const archKey = ARCHITECTURE_MAP.get(architecture);
    if (archKey) {
      const preset = MODEL_PRESETS[archKey];
      // If we also have a filename match, check if it's the SAME preset key.
      if (filename) {
        for (const { pattern, key } of FILENAME_PATTERNS) {
          if (pattern.test(filename)) {
            if (key === archKey) {
              return {
                overrides: preset.overrides,
                confidence: 'exact',
                presetKey: archKey,
                name: preset.name,
              };
            }
            // Filename points to a different preset than architecture.
            // Prefer the filename-specific one (more granular).
            const filenamePreset = MODEL_PRESETS[key];
            return {
              overrides: filenamePreset.overrides,
              confidence: 'filename',
              presetKey: key,
              name: filenamePreset.name,
            };
          }
        }
      }
      return {
        overrides: preset.overrides,
        confidence: 'architecture',
        presetKey: archKey,
        name: preset.name,
      };
    }
  }

  // Fall back to filename heuristic.
  if (filename) {
    for (const { pattern, key } of FILENAME_PATTERNS) {
      if (pattern.test(filename)) {
        const preset = MODEL_PRESETS[key];
        return {
          overrides: preset.overrides,
          confidence: 'filename',
          presetKey: key,
          name: preset.name,
        };
      }
    }
  }

  return {
    overrides: null,
    confidence: 'none',
    presetKey: null,
    name: null,
  };
}

module.exports = {
  MODEL_PRESETS,
  lookupPreset,
};
