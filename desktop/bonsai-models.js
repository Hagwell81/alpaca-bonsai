/**
 * Bonsai Model Catalog
 *
 * Mirrors the model definitions in bonsai-beach/config/bonsai-beach.toml so
 * the Alpaca desktop onboarding/models page can offer the prerequisite
 * Bonsai ternary, image, TTS, and STT models for download.
 *
 * Each entry maps a logical model id to one or more files (with HuggingFace
 * download URLs) that must be present in the user's models directory before
 * the model can be loaded. The Electron main process uses this catalog to
 * drive the onboarding download flow; the existing HuggingFaceModelService
 * remains available in Settings for adding any additional GGUF models.
 *
 * Directory layout (matches alpaca-bonsai/models/):
 *   models/chat/    - Bonsai chat (ternary) GGUF models + mmproj
 *   models/image/   - Bonsai image diffusion GGUF + text encoder + VAE
 *   models/whisper/ - Whisper STT (.bin) + OuteTTS TTS (.gguf) + WavTokenizer
 */

'use strict';

/**
 * @typedef {Object} BonsaiModelFile
 * @property {string} kind        - File role: main | mmproj | dspark | diffusion | text_encoder | vae | llm | decoder | whisper
 * @property {string} filename    - File name on disk
 * @property {string} url         - Direct download URL
 * @property {string} [subdir]    - Subdirectory under models/ (chat | image | whisper); defaults to kind-specific
 * @property {boolean} [optional] - If true, the model can still load without this file
 */

/**
 * @typedef {Object} BonsaiModelDefinition
 * @property {string} id           - Stable model id (e.g. "bonsai-27b")
 * @property {string} displayName  - Human-readable name
 * @property {string} kind         - chat | image | tts | stt
 * @property {string} family       - Model family (e.g. "ternary")
 * @property {string} [size]       - Parameter size label (e.g. "27B")
 * @property {boolean} enabled     - Whether the model is enabled by default
 * @property {number} port         - Reserved port (matches bonsai-beach range 15450-15459)
 * @property {string} [quant]      - Quantization label
 * @property {string} [description]
 * @property {BonsaiModelFile[]} files
 */

const HF_BASE = 'https://huggingface.co';

// Public HuggingFace repos for the Bonsai model family. The canonical
// `bonsai/ternary-bonsai` and `bonsai/bonsai-image-4b` repos are gated and
// require a HONSAI_TOKEN; these public mirrors published by Prism ML and
// Green-Sky are downloadable without authentication.
const BONSAI_27B_REPO = 'prism-ml/Ternary-Bonsai-27B-gguf';
const BONSAI_8B_REPO = 'prism-ml/Ternary-Bonsai-8B-gguf';
const BONSAI_IMAGE_REPO = 'Green-Sky/bonsai-image-binary-4B-GGUF';

/**
 * Canonical bonsai model catalog. Keep this in sync with
 * bonsai-beach/config/bonsai-beach.toml.
 */
const BONSAI_MODELS = [
  {
    id: 'bonsai-27b',
    displayName: 'Bonsai 27B (chat + vision)',
    kind: 'chat',
    family: 'ternary',
    size: '27B',
    enabled: true,
    port: 15452,
    quant: 'Q2_0',
    mmprojQuant: 'Q8_0',
    description: 'Ternary Bonsai 27B chat model with vision (mmproj). Recommended for Claude Code and tool calling. Includes optional dspark drafter for speculative decoding (~1.8-2x faster decode on CUDA).',
    files: [
      {
        kind: 'main',
        filename: 'Ternary-Bonsai-27B-Q2_0.gguf',
        url: `${HF_BASE}/${BONSAI_27B_REPO}/resolve/main/Ternary-Bonsai-27B-Q2_0.gguf`,
        subdir: 'chat'
      },
      {
        kind: 'mmproj',
        filename: 'Ternary-Bonsai-27B-mmproj-Q8_0.gguf',
        url: `${HF_BASE}/${BONSAI_27B_REPO}/resolve/main/Ternary-Bonsai-27B-mmproj-Q8_0.gguf`,
        subdir: 'chat'
      },
      {
        kind: 'dspark',
        filename: 'Ternary-Bonsai-27B-dspark-Q4_1.gguf',
        url: `${HF_BASE}/${BONSAI_27B_REPO}/resolve/main/Ternary-Bonsai-27B-dspark-Q4_1.gguf`,
        subdir: 'chat',
        optional: true  // Only needed for speculative decoding (experimental)
      }
    ]
  },
  {
    id: 'bonsai-8b',
    displayName: 'Bonsai 8B (chat)',
    kind: 'chat',
    family: 'ternary',
    size: '8B',
    enabled: true,
    port: 15453,
    quant: 'Q2_0',
    description: 'Ternary Bonsai 8B chat model. Lighter than 27B, no vision.',
    files: [
      {
        kind: 'main',
        filename: 'Ternary-Bonsai-8B-Q2_0.gguf',
        url: `${HF_BASE}/${BONSAI_8B_REPO}/resolve/main/Ternary-Bonsai-8B-Q2_0.gguf`,
        subdir: 'chat'
      }
    ]
  },
  {
    id: 'bonsai-image-4b',
    displayName: 'Bonsai Image 4B (diffusion)',
    kind: 'image',
    enabled: true,
    port: 15454,
    description: 'Bonsai Image 4B diffusion model (sd.cpp). Paired with a Qwen3 text encoder and a VAE.',
    // Flags mirror bonsai-beach config.rs bonsai-image-4b defaults.
    // These are passed to sd-cli by image-service.js.
    flags: {
      steps: 6,
      cfgScale: 1.0,
      sampling: 'dpm++2s_a',
      fa: true,            // flash attention
      vaeTiling: true,     // tile VAE to reduce VRAM
      vaeTileSize: 64,
      offloadToCpu: true,  // offload VAE to CPU
      backend: 'vae=cpu'   // run VAE on CPU, diffusion on GPU
    },
    files: [
      {
        kind: 'diffusion',
        filename: 'bonsai_image_4b-mod_q8_0-q1_0.gguf',
        url: `${HF_BASE}/${BONSAI_IMAGE_REPO}/resolve/main/bonsai_image_4b-mod_q8_0-q1_0.gguf`,
        subdir: 'image'
      },
      {
        kind: 'text_encoder',
        filename: 'Qwen3-4B-UD-IQ3_XXS.gguf',
        url: `${HF_BASE}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-UD-IQ3_XXS.gguf`,
        subdir: 'image'
      },
      {
        kind: 'vae',
        filename: 'full_encoder_small_decoder.safetensors',
        url: `${HF_BASE}/leejet/stable-diffusion.cpp/resolve/main/vae/full_encoder_small_decoder.safetensors`,
        subdir: 'image'
      }
    ]
  },
  {
    id: 'bonsai-tts',
    displayName: 'Bonsai TTS (OuteTTS)',
    kind: 'tts',
    enabled: true,
    port: 15455,
    description: 'OuteTTS-0.2-500M LLM paired with a WavTokenizer decoder for local text-to-speech.',
    files: [
      {
        kind: 'llm',
        filename: 'OuteTTS-0.2-500M-Q8_0.gguf',
        url: `${HF_BASE}/OuteAI/OuteTTS-0.2-500M-GGUF/resolve/main/OuteTTS-0.2-500M-Q8_0.gguf`,
        subdir: 'whisper'
      },
      {
        kind: 'decoder',
        filename: 'WavTokenizer-Large-75-Q4_0.gguf',
        url: `${HF_BASE}/community/wavtokenizer-large-75-GGUF/resolve/main/WavTokenizer-Large-75-Q4_0.gguf`,
        subdir: 'whisper'
      }
    ]
  },
  {
    id: 'bonsai-stt',
    displayName: 'Bonsai STT (Whisper large-v3-turbo)',
    kind: 'stt',
    enabled: true,
    port: 15456,
    description: 'Whisper large-v3-turbo Q8_0 for local speech-to-text (microphone input).',
    files: [
      {
        kind: 'whisper',
        filename: 'ggml-large-v3-turbo-q8_0.bin',
        url: `${HF_BASE}/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin`,
        subdir: 'whisper'
      }
    ]
  }
];

/**
 * Return all bonsai model definitions.
 * @returns {BonsaiModelDefinition[]}
 */
function listBonsaiModels() {
  return BONSAI_MODELS;
}

/**
 * Return a single bonsai model definition by id.
 * @param {string} id
 * @returns {BonsaiModelDefinition|undefined}
 */
function getBonsaiModel(id) {
  return BONSAI_MODELS.find((m) => m.id === id);
}

/**
 * Return the bonsai chat models (for the chat UI model selector defaults).
 * @returns {BonsaiModelDefinition[]}
 */
function listBonsaiChatModels() {
  return BONSAI_MODELS.filter((m) => m.kind === 'chat');
}

/**
 * Return the bonsai image model definition.
 * @returns {BonsaiModelDefinition|undefined}
 */
function getBonsaiImageModel() {
  return BONSAI_MODELS.find((m) => m.kind === 'image');
}

/**
 * Check which files for a given bonsai model are missing from a models directory.
 *
 * @param {string} modelsDir - Root models directory (containing chat/, image/, whisper/)
 * @param {string} [modelId] - If supplied, only check that model; otherwise check all enabled models
 * @returns {Array<{modelId: string, kind: string, filename: string, url: string, dest: string}>}
 */
function listMissingFiles(modelsDir, modelId) {
  const missing = [];
  const models = modelId ? [getBonsaiModel(modelId)].filter(Boolean) : BONSAI_MODELS.filter((m) => m.enabled);
  const fs = require('fs');
  const path = require('path');
  for (const model of models) {
    for (const file of model.files) {
      const subdir = file.subdir || defaultSubdirForKind(file.kind, model.kind);
      const dest = path.join(modelsDir, subdir, file.filename);
      if (!fs.existsSync(dest)) {
        missing.push({ modelId: model.id, kind: file.kind, filename: file.filename, url: file.url, dest });
      }
    }
  }
  return missing;
}

function defaultSubdirForKind(fileKind, modelKind) {
  if (modelKind === 'chat') return 'chat';
  if (modelKind === 'image') return 'image';
  return 'whisper';
}

module.exports = {
  BONSAI_MODELS,
  listBonsaiModels,
  getBonsaiModel,
  listBonsaiChatModels,
  getBonsaiImageModel,
  listMissingFiles
};
