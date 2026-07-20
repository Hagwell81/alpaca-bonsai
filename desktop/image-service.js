/**
 * Image Service
 *
 * Provides local image generation via sd.cpp (stable-diffusion.cpp) using the
 * Bonsai Image 4B diffusion model. Mirrors the image generation flow in
 * bonsai-beach/crates/bonsai-beach/src/openai_proxy.rs.
 *
 * Architecture:
 * - The sd-cli binary is downloaded on demand by binary-manager.ensureSdBackend().
 * - The Bonsai Image 4B model files (diffusion GGUF, text encoder GGUF, VAE
 *   safetensors) are tracked by bonsai-models.js and downloaded via the
 *   bonsai:download-model IPC handler.
 * - generateImage() spawns sd-cli with the appropriate flags, writes the
 *   output PNG to a temp file, and returns either the file path or a base64
 *   string.
 *
 * The service exposes an OpenAI-compatible /v1/images/generations endpoint
 * shape so the webui image route and the inline /imagine chat command can
 * both use the same API.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { ensureSdBackend } = require('./binary-manager');
const { getBonsaiImageModel, listMissingFiles } = require('./bonsai-models');

class ImageService {
  /**
   * @param {Object} opts
   * @param {import('electron').App} opts.app
   * @param {Object} [opts.logger]
   * @param {Object} [opts.hardwareCapabilities] - Cached hardware caps for backend selection
   */
  constructor({ app, logger = console, hardwareCapabilities = null } = {}) {
    this.app = app;
    this.logger = logger;
    this.hardwareCapabilities = hardwareCapabilities;
    this.sdCliPath = null;
    this._ready = false;
  }

  /**
   * Ensure the sd-cli binary and Bonsai Image 4B model files are present.
   * @returns {Promise<{ready: boolean, missing: string[], error?: string}>}
   */
  async ensureReady() {
    const errors = [];
    // 1. sd-cli binary — pass hardware capabilities so the correct GPU
    //    backend (vulkan/cuda/cpu) is selected from the leejet release.
    try {
      this.sdCliPath = await ensureSdBackend(this.app, {
        onProgress: (pct) => this.logger.log(`[ImageService] sd-cli download: ${pct}%`),
        hardwareCapabilities: this.hardwareCapabilities
      });
    } catch (err) {
      errors.push(`sd-cli: ${err.message}`);
    }

    // 2. Bonsai Image 4B model files
    const modelsDir = this._getModelsDir();
    const missing = listMissingFiles(modelsDir, 'bonsai-image-4b');
    if (missing.length > 0) {
      errors.push(`bonsai-image-4b: ${missing.length} file(s) missing — ${missing.map(m => m.filename).join(', ')}`);
    }

    this._ready = errors.length === 0;
    return { ready: this._ready, missing: errors };
  }

  /**
   * Generate an image from a text prompt using sd-cli.
   *
   * @param {Object} params
   * @param {string} params.prompt - Text prompt
   * @param {string} [params.negativePrompt] - Negative prompt
   * @param {number} [params.width=512] - Output width
   * @param {number} [params.height=512] - Output height
   * @param {number} [params.steps=6] - Number of diffusion steps
   * @param {number} [params.cfgScale=1.0] - CFG scale
   * @param {string} [params.samplingMethod='dpm++2s_a'] - Sampling method
   * @param {number} [params.seed] - Random seed
   * @param {boolean} [params.b64=false] - If true, return base64; otherwise return file path
   * @returns {Promise<{success: boolean, path?: string, b64?: string, error?: string}>}
   */
  async generateImage({
    prompt,
    negativePrompt,
    width = 512,
    height = 512,
    steps,
    cfgScale,
    samplingMethod,
    seed,
    b64 = false
  } = {}) {
    if (!prompt || typeof prompt !== 'string') {
      return { success: false, error: 'prompt is required' };
    }

    if (!this._ready) {
      const status = await this.ensureReady();
      if (!status.ready) {
        return { success: false, error: `Image service not ready: ${status.missing.join('; ')}` };
      }
    }

    const imageModel = getBonsaiImageModel();
    if (!imageModel) {
      return { success: false, error: 'bonsai-image-4b model definition not found' };
    }

    // Apply model flags from bonsai-models.js (mirrors bonsai-beach config.rs)
    const flags = imageModel.flags || {};
    const effectiveSteps = steps ?? flags.steps ?? 6;
    const effectiveCfgScale = cfgScale ?? flags.cfgScale ?? 1.0;
    const effectiveSampling = samplingMethod ?? flags.sampling ?? 'dpm++2s_a';

    const modelsDir = this._getModelsDir();
    const diffusionPath = path.join(modelsDir, 'image', this._getFile(imageModel, 'diffusion'));
    const textEncoderPath = path.join(modelsDir, 'image', this._getFile(imageModel, 'text_encoder'));
    const vaePath = path.join(modelsDir, 'image', this._getFile(imageModel, 'vae'));

    if (!fs.existsSync(diffusionPath)) {
      return { success: false, error: `diffusion model not found: ${diffusionPath}` };
    }

    // Output file
    const outputDir = path.join(this.app.getPath('userData'), 'images');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outName = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    const outPath = path.join(outputDir, outName);

    // Build sd-cli args (matches bonsai-beach openai_proxy.rs)
    const args = [
      '--diffusion-model', diffusionPath,
      '-H', String(height),
      '-W', String(width),
      '--steps', String(effectiveSteps),
      '--cfg-scale', String(effectiveCfgScale),
      '--sampling-method', effectiveSampling,
      '-p', prompt,
      '-o', outPath
    ];

    if (fs.existsSync(textEncoderPath)) {
      args.push('--llm', textEncoderPath);
    }
    if (fs.existsSync(vaePath)) {
      args.push('--vae', vaePath);
    }
    // Flash attention
    if (flags.fa) {
      args.push('--fa');
    }
    // VAE tiling (reduces VRAM usage)
    if (flags.vaeTiling) {
      args.push('--vae-tiling');
      args.push('--vae-tile-size');
      args.push(String(flags.vaeTileSize ?? 64));
    }
    // Offload VAE to CPU
    if (flags.offloadToCpu) {
      args.push('--offload-to-cpu');
    }
    // Backend selection (e.g. "vae=cpu" runs VAE on CPU, diffusion on GPU)
    if (flags.backend) {
      args.push('--backend', flags.backend);
    }
    if (negativePrompt) {
      args.push('--negative-prompt', negativePrompt);
    }
    if (seed !== undefined && seed !== null) {
      args.push('--seed', String(seed));
    }

    this.logger.log(`[ImageService] running sd-cli with ${args.length} args`);

    try {
      const result = await this._runSdCli(args);
      if (!result.success) {
        return { success: false, error: result.error || 'sd-cli failed' };
      }

      if (!fs.existsSync(outPath)) {
        return { success: false, error: 'sd-cli completed but output file not found' };
      }

      if (b64) {
        const bytes = fs.readFileSync(outPath);
        const b64 = bytes.toString('base64');
        // Clean up temp file when returning b64
        try { fs.unlinkSync(outPath); } catch { /* ignore */ }
        return { success: true, b64 };
      }

      return { success: true, path: outPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Get the status of the image service.
   */
  getStatus() {
    const model = getBonsaiImageModel() || null;
    return {
      ready: this._ready,
      sdCliPath: this.sdCliPath,
      imageModel: model,
      flags: model?.flags || null
    };
  }

  _runSdCli(args) {
    return new Promise((resolve) => {
      if (!this.sdCliPath || !fs.existsSync(this.sdCliPath)) {
        resolve({ success: false, error: 'sd-cli binary not found' });
        return;
      }
      const child = spawn(this.sdCliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => {
        resolve({ success: false, error: `spawn error: ${err.message}` });
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `sd-cli exited with code ${code}: ${stderr.slice(-500)}` });
        }
      });
    });
  }

  _getFile(model, kind) {
    const file = model.files.find(f => f.kind === kind);
    return file ? file.filename : '';
  }

  _getModelsDir() {
    return path.join(this.app.getPath('userData'), 'models');
  }
}

module.exports = { ImageService };
