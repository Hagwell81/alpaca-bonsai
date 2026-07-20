const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// Bonsai voice backend configuration (mirrors bonsai-beach config/bonsai-beach.toml).
// STT uses whisper.cpp (ggerganov/whisper.cpp) with the ggml-large-v3-turbo-q8_0 model.
// TTS uses OuteTTS-0.2-500M-Q8_0.gguf paired with WavTokenizer-Large-75-Q4_0.gguf,
// driven by the llama-tts binary from the bonsai llama.cpp release.
const WHISPER_GITHUB_API = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest';
const TTS_GITHUB_API = 'https://api.github.com/repos/PrismML-Eng/llama.cpp/releases/latest';

// Default bonsai voice models (see alpaca-bonsai/models/whisper/).
const DEFAULT_STT_MODEL = 'ggml-large-v3-turbo-q8_0.bin';
const DEFAULT_TTS_LLM_MODEL = 'OuteTTS-0.2-500M-Q8_0.gguf';
const DEFAULT_TTS_DECODER_MODEL = 'WavTokenizer-Large-75-Q4_0.gguf';

// HuggingFace download URLs for the bonsai voice models.
const STT_MODEL_URL = (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
const TTS_LLM_MODEL_URL = 'https://huggingface.co/OuteAI/OuteTTS-0.2-500M-GGUF/resolve/main/OuteTTS-0.2-500M-Q8_0.gguf';
const TTS_DECODER_MODEL_URL = 'https://huggingface.co/community/wavtokenizer-large-75-GGUF/resolve/main/WavTokenizer-Large-75-Q4_0.gguf';

/**
 * Map current platform/arch to whisper.cpp release asset name.
 * Follows the same pattern as binary-manager.js for llama.cpp backends.
 */
function mapPlatformToWhisperAsset() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    // Use CPU-only build by default; CUDA builds are opt-in via manual install
    return arch === 'x64' ? 'whisper-bin-x64.zip'
      : arch === 'ia32' ? 'whisper-bin-Win32.zip'
      : null;
  }
  if (platform === 'darwin') {
    return 'whisper-bin-x64.zip'; // macOS releases use x64 zip with universal binary
  }
  if (platform === 'linux') {
    return arch === 'x64' ? 'whisper-bin-x64.zip'
      : arch === 'arm64' ? 'whisper-bin-arm64.zip'
      : arch === 'arm' ? 'whisper-bin-arm.zip'
      : null;
  }
  return null;
}

function mapPlatformToTtsAsset() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    return arch === 'x64' ? 'llama-bin-win-avx2-x64.zip' : null;
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'llama-bin-macos-arm64.zip' : 'llama-bin-macos-x64.zip';
  }
  if (platform === 'linux') {
    return arch === 'x64' ? 'llama-bin-ubuntu-x64.zip'
      : arch === 'arm64' ? 'llama-bin-linux-arm64.zip'
      : null;
  }
  return null;
}

/**
 * VoiceService provides local speech-to-text (STT) and text-to-speech (TTS).
 *
 * STT uses whisper.cpp (ggml-org/whisper.cpp) with an auto-downloaded binary
 * and model, following the same GitHub-releases + cache pattern as the
 * llama.cpp backend manager.
 * TTS uses tts.cpp (ggml-org/llama.cpp /tts) when available, then falls back
 * to MOSS-TTS, then browser Web Speech API.
 */
class VoiceService {
  /**
   * @param {Object} options
   * @param {import('electron').App} options.app
   * @param {import('electron-store')} options.store
   * @param {Console} options.logger
   */
  constructor({ app, store, logger = console }) {
    this.app = app;
    this.store = store;
    this.logger = logger;

    this.voiceDir = null;
    this.whisperBinaryPath = null;
    this.whisperModelPath = null;
    this.ttsBinaryPath = null;
    this.ttsModelPath = null;
    this.ttsDecoderPath = null;
    this.pythonPath = null;
    this.mossTtsPort = 13440; // fixed port next to slots (13434-13438 are slots, 13439 is API Gateway)

    this._status = {
      sttReady: false,
      ttsReady: false,
      ttsMode: 'browser', // 'browser' | 'moss' | 'tts_cpp'
      whisperBinaryReady: false,
      whisperModelReady: false,
      ttsCppBinaryReady: false,
      ttsCppModelReady: false,
      ttsDecoderReady: false,
      mossTtsAvailable: false
    };
  }

  /** @returns {Object} Current voice service status snapshot. */
  get status() {
    return { ...this._status };
  }

  /**
   * Initialize directories and detect available backends.
   */
  async init() {
    this.voiceDir = path.join(this.app.getPath('userData'), 'voice');
    if (!fs.existsSync(this.voiceDir)) {
      fs.mkdirSync(this.voiceDir, { recursive: true });
    }

    this._detectPython();
    await this._resolveWhisperBinary();
    await this._resolveWhisperModel();
    await this._resolveTtsBinary();
    await this._resolveTtsModel();
    await this._checkMossTts();
    this._updateStatus();

    this.logger.log('[VoiceService] Status:', this._status);
  }

  // ------------------------------------------------------------------
  // STT
  // ------------------------------------------------------------------

  /**
   * Ensure STT is ready: whisper binary + model are both present.
   *
   * Downloads whichever piece is missing. Idempotent — returns immediately
   * if STT is already ready. Called from main.js onboarding so it accepts
   * an optional onProgress(phase, current, total) callback.
   *
   * @param {Object} [options]
   * @param {(phase:string,current:number,total:number)=>void} [options.onProgress]
   * @returns {Promise<{sttReady:boolean, whisperBinaryReady:boolean, whisperModelReady:boolean}>}
   */
  async ensureSttReady(options = {}) {
    const onProgress = options.onProgress || (() => {});

    // 1. Binary
    if (!this._status.whisperBinaryReady) {
      onProgress('downloading-binary', 0, 0);
      try {
        await this._downloadWhisperBinary();
        this._updateStatus();
      } catch (err) {
        this.logger.warn('[VoiceService] ensureSttReady: whisper binary download failed:', err.message);
      }
    }

    // 2. Model
    if (!this._status.whisperModelReady) {
      onProgress('downloading-model', 0, 0);
      try {
        const result = await this.downloadWhisperModelWithProgress((current, total) => {
          onProgress('downloading-model', current, total);
        });
        if (!result.success) {
          this.logger.warn('[VoiceService] ensureSttReady: whisper model download failed:', result.error);
        }
        this._updateStatus();
      } catch (err) {
        this.logger.warn('[VoiceService] ensureSttReady: whisper model download failed:', err.message);
      }
    }

    onProgress('done', 0, 0);
    return {
      sttReady: this._status.sttReady,
      whisperBinaryReady: this._status.whisperBinaryReady,
      whisperModelReady: this._status.whisperModelReady
    };
  }

  /**
   * Download the default whisper STT model, reporting download progress.
   * @param {(current:number,total:number)=>void} [onProgress]
   * @returns {Promise<{success:boolean,skipped?:boolean,error?:string}>}
   */
  async downloadWhisperModelWithProgress(onProgress = () => {}) {
    const modelName = DEFAULT_STT_MODEL;
    const modelPath = path.join(this.voiceDir, modelName);
    if (fs.existsSync(modelPath)) {
      this.whisperModelPath = modelPath;
      this._updateStatus();
      return { success: true, skipped: true };
    }
    const downloadUrl = STT_MODEL_URL(modelName);
    this.logger.log(`[VoiceService] Downloading whisper model: ${modelName}`);
    const result = await this._downloadFile(downloadUrl, modelPath, onProgress);
    if (result.success) {
      this.whisperModelPath = modelPath;
      this._updateStatus();
    }
    return result;
  }

  /**
   * Transcribe an audio buffer using whisper.cpp.
   *
   * @param {Buffer} audioBuffer - Raw audio data (WAV or FLAC)
   * @param {string} [format='wav'] - Audio format extension
   * @returns {Promise<{text: string, language?: string}>}
   */
  async transcribe(audioBuffer, format = 'wav') {
    if (!this._status.sttReady) {
      throw new Error('STT not ready. Whisper binary or model missing.');
    }

    const tmpFile = path.join(os.tmpdir(), `alpaca-stt-${Date.now()}.${format}`);
    fs.writeFileSync(tmpFile, audioBuffer);

    try {
      const text = await this._runWhisper(tmpFile);
      return { text: text.trim(), language: 'auto' };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Download a whisper STT model from HuggingFace.
   *
   * Defaults to the bonsai STT model (ggml-large-v3-turbo-q8_0.bin) which is
   * paired with the Bonsai 27B/8B chat models in the bonsai-beach config.
   *
   * @param {string} [modelName=DEFAULT_STT_MODEL] - Model filename
   * @param {string} [url] - Direct download URL; auto-generated if omitted
   * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
   */
  async downloadWhisperModel(modelName = DEFAULT_STT_MODEL, url) {
    const modelPath = path.join(this.voiceDir, modelName);
    if (fs.existsSync(modelPath)) {
      return { success: true, skipped: true };
    }

    const downloadUrl =
      url ||
      STT_MODEL_URL(modelName);

    this.logger.log(`[VoiceService] Downloading whisper model: ${modelName}`);
    const result = await this._downloadFile(downloadUrl, modelPath);

    if (result.success) {
      this.whisperModelPath = modelPath;
      this._updateStatus();
    }
    return result;
  }

  // ------------------------------------------------------------------
  // TTS
  // ------------------------------------------------------------------

  /**
   * Synthesize speech from text.
   *
   * Priority:
   * 1. tts.cpp (local C++ TTS)
   * 2. MOSS-TTS Python server
   * 3. Browser Web Speech API
   *
   * @param {string} text
   * @param {Object} [options]
   * @param {string} [options.voice='default']
   * @param {number} [options.speed=1.0]
   * @returns {Promise<{mode: 'browser'|'moss'|'tts_cpp', audioBuffer?: Buffer, mimeType?: string}>}
   */
  async synthesize(text, options = {}) {
    if (this._status.ttsCppBinaryReady && this._status.ttsCppModelReady) {
      try {
        const audioBuffer = await this._runTtsCpp(text, options);
        return { mode: 'tts_cpp', audioBuffer, mimeType: 'audio/wav' };
      } catch (err) {
        this.logger.warn('[VoiceService] tts.cpp failed:', err.message);
      }
    }

    if (this._status.mossTtsAvailable) {
      try {
        const audioBuffer = await this._callMossTts(text, options);
        return { mode: 'moss', audioBuffer, mimeType: 'audio/wav' };
      } catch (err) {
        this.logger.warn('[VoiceService] MOSS-TTS failed, falling back to browser:', err.message);
      }
    }
    return { mode: 'browser' };
  }

  /**
   * Download a TTS model from HuggingFace.
   *
   * Defaults to the bonsai TTS LLM model (OuteTTS-0.2-500M-Q8_0.gguf). The
   * OuteTTS model also requires a WavTokenizer decoder
   * (WavTokenizer-Large-75-Q4_0.gguf) which can be fetched via
   * `downloadTtsDecoderModel()`.
   *
   * @param {string} [modelName=DEFAULT_TTS_LLM_MODEL] - Model filename
   * @param {string} [url] - Direct download URL
   * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
   */
  async downloadTtsModel(modelName = DEFAULT_TTS_LLM_MODEL, url) {
    const modelPath = path.join(this.voiceDir, modelName);
    if (fs.existsSync(modelPath)) {
      return { success: true, skipped: true };
    }

    const downloadUrl = url || TTS_LLM_MODEL_URL;
    this.logger.log(`[VoiceService] Downloading TTS model: ${modelName}`);
    const result = await this._downloadFile(downloadUrl, modelPath);

    if (result.success) {
      this.ttsModelPath = modelPath;
      this._updateStatus();
    }
    return result;
  }

  /**
   * Download the WavTokenizer decoder model required by OuteTTS.
   *
   * @param {string} [modelName=DEFAULT_TTS_DECODER_MODEL] - Decoder filename
   * @param {string} [url] - Direct download URL
   * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
   */
  async downloadTtsDecoderModel(modelName = DEFAULT_TTS_DECODER_MODEL, url) {
    const modelPath = path.join(this.voiceDir, modelName);
    if (fs.existsSync(modelPath)) {
      return { success: true, skipped: true };
    }
    const downloadUrl = url || TTS_DECODER_MODEL_URL;
    this.logger.log(`[VoiceService] Downloading TTS decoder model: ${modelName}`);
    const result = await this._downloadFile(downloadUrl, modelPath);
    if (result.success) {
      this.ttsDecoderPath = modelPath;
      this._updateStatus();
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  _updateStatus() {
    this._status.whisperBinaryReady = !!this.whisperBinaryPath && fs.existsSync(this.whisperBinaryPath);
    this._status.whisperModelReady = !!this.whisperModelPath && fs.existsSync(this.whisperModelPath);
    this._status.sttReady = this._status.whisperBinaryReady && this._status.whisperModelReady;
    this._status.ttsCppBinaryReady = !!this.ttsBinaryPath && fs.existsSync(this.ttsBinaryPath);
    this._status.ttsCppModelReady = !!this.ttsModelPath && fs.existsSync(this.ttsModelPath);
    this._status.ttsDecoderReady = !!this.ttsDecoderPath && fs.existsSync(this.ttsDecoderPath);
    this._status.mossTtsAvailable = !!this._mossTtsReady;
    this._status.ttsReady = true; // browser TTS is always available
    this._status.ttsMode = this._status.ttsCppBinaryReady && this._status.ttsCppModelReady ? 'tts_cpp'
      : this._status.mossTtsAvailable ? 'moss'
      : 'browser';
  }

  _detectPython() {
    const candidates =
      process.platform === 'win32'
        ? ['python.exe', 'python3.exe', 'py.exe']
        : ['python3', 'python'];

    const pathEnv = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathEnv) {
      for (const bin of candidates) {
        const full = path.join(dir, bin);
        if (fs.existsSync(full)) {
          this.pythonPath = full;
          return;
        }
      }
    }
    this.pythonPath = null;
  }

  async _resolveWhisperBinary() {
    const exeName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const localPath = path.join(this.voiceDir, exeName);
    if (fs.existsSync(localPath)) {
      this.whisperBinaryPath = localPath;
      return;
    }
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      const p = path.join(dir, exeName);
      if (fs.existsSync(p)) {
        this.whisperBinaryPath = p;
        return;
      }
    }
    try {
      this.logger.log('[VoiceService] whisper-cli not found locally, attempting auto-download from GitHub releases...');
      await this._downloadWhisperBinary();
      if (this.whisperBinaryPath && fs.existsSync(this.whisperBinaryPath)) {
        this.logger.log('[VoiceService] whisper-cli auto-downloaded to:', this.whisperBinaryPath);
        return;
      }
    } catch (err) {
      this.logger.warn('[VoiceService] Auto-download failed:', err.message);
    }
    this.whisperBinaryPath = null;
  }

  async _resolveWhisperModel() {
    // Prefer the bonsai STT model (ggml-large-v3-turbo-q8_0.bin), then fall
    // back to any other ggml-*.bin model present in the voice directory.
    const candidates = [DEFAULT_STT_MODEL, 'ggml-tiny.bin'];
    for (const name of candidates) {
      const modelPath = path.join(this.voiceDir, name);
      if (fs.existsSync(modelPath)) {
        this.whisperModelPath = modelPath;
        return;
      }
    }
    if (fs.existsSync(this.voiceDir)) {
      const fallback = fs.readdirSync(this.voiceDir).find(f => /^ggml-.*\.bin$/i.test(f));
      if (fallback) this.whisperModelPath = path.join(this.voiceDir, fallback);
    }
  }

  async _resolveTtsBinary() {
    const exeName = process.platform === 'win32' ? 'tts-cli.exe' : 'tts-cli';
    const localPath = path.join(this.voiceDir, exeName);
    if (fs.existsSync(localPath)) {
      this.ttsBinaryPath = localPath;
      return;
    }
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      const p = path.join(dir, exeName);
      if (fs.existsSync(p)) {
        this.ttsBinaryPath = p;
        return;
      }
    }
    // tts.cpp is often bundled in llama.cpp releases as llama-tts
    const altName = process.platform === 'win32' ? 'llama-tts.exe' : 'llama-tts';
    for (const dir of pathDirs) {
      const p = path.join(dir, altName);
      if (fs.existsSync(p)) {
        this.ttsBinaryPath = p;
        return;
      }
    }
    this.ttsBinaryPath = null;
  }

  async _resolveTtsModel() {
    // Prefer the bonsai TTS LLM (OuteTTS-0.2-500M-Q8_0.gguf) and its
    // WavTokenizer decoder, then fall back to any OuteTTS-*.gguf present.
    const llmCandidates = [DEFAULT_TTS_LLM_MODEL];
    for (const name of llmCandidates) {
      const modelPath = path.join(this.voiceDir, name);
      if (fs.existsSync(modelPath)) {
        this.ttsModelPath = modelPath;
        break;
      }
    }
    if (!this.ttsModelPath && fs.existsSync(this.voiceDir)) {
      const fallback = fs.readdirSync(this.voiceDir).find(f => /^OuteTTS-.*\.gguf$/i.test(f));
      if (fallback) this.ttsModelPath = path.join(this.voiceDir, fallback);
    }

    const decoderPath = path.join(this.voiceDir, DEFAULT_TTS_DECODER_MODEL);
    if (fs.existsSync(decoderPath)) {
      this.ttsDecoderPath = decoderPath;
    } else if (fs.existsSync(this.voiceDir)) {
      const fallback = fs.readdirSync(this.voiceDir).find(f => /^WavTokenizer-.*\.gguf$/i.test(f));
      if (fallback) this.ttsDecoderPath = path.join(this.voiceDir, fallback);
    }
  }

  async _checkMossTts() {
    this._mossTtsReady = false;
    if (!this.pythonPath) return;
    try {
      const alive = await this._httpGet(`http://127.0.0.1:${this.mossTtsPort}/health`, 2000);
      this._mossTtsReady = alive;
    } catch {
      this._mossTtsReady = false;
    }
  }

  _runWhisper(audioFilePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.whisperModelPath,
        '-f', audioFilePath,
        '-np',
        '-nt'
      ];
      const proc = spawn(this.whisperBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        resolve(lines.join(' '));
      });
      proc.on('error', (err) => reject(err));
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('whisper-cli transcription timeout'));
      }, 60_000);
    });
  }

  async _runTtsCpp(text, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.ttsModelPath,
        '-t', text,
        '-np'
      ];
      if (options.speed) {
        args.push('--speed', String(options.speed));
      }
      const proc = spawn(this.ttsBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const chunks = [];
      let stderr = '';
      proc.stdout.on('data', (d) => { chunks.push(d); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`tts-cli exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      proc.on('error', (err) => reject(err));
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('tts-cli synthesis timeout'));
      }, 60_000);
    });
  }

  async _callMossTts(text, options = {}) {
    const payload = JSON.stringify({
      text,
      voice: options.voice || 'default',
      speed: options.speed || 1.0
    });
    const res = await this._httpPost(
      `http://127.0.0.1:${this.mossTtsPort}/synthesize`,
      payload,
      { 'Content-Type': 'application/json' },
      30_000
    );
    if (!res.ok) {
      throw new Error(`MOSS-TTS HTTP ${res.status}: ${res.body}`);
    }
    return res.body;
  }

  _httpGet(url, timeoutMs) {
    return new Promise((resolve) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : require('http');
      let settled = false;
      const req = client.get(url, { timeout: timeoutMs }, (res) => {
        if (!settled) { settled = true; resolve(res.statusCode === 200); }
      });
      req.on('error', () => {
        if (!settled) { settled = true; resolve(false); }
      });
      req.on('timeout', () => {
        if (!settled) { settled = true; req.destroy(); resolve(false); }
      });
      req.setTimeout(timeoutMs);
      setTimeout(() => {
        if (!settled) { settled = true; req.destroy(); resolve(false); }
      }, timeoutMs + 500);
    });
  }

  _httpPost(url, data, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : require('http');
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: timeoutMs
      };
      let settled = false;
      const req = client.request(options, (res) => {
        if (settled) return;
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks) });
        });
      });
      req.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
      });
      req.on('timeout', () => {
        if (!settled) { settled = true; req.destroy(); reject(new Error('HTTP POST timeout')); }
      });
      req.write(data);
      req.end();
      setTimeout(() => {
        if (!settled) { settled = true; req.destroy(); reject(new Error('HTTP POST hard timeout')); }
      }, timeoutMs + 500);
    });
  }

  async _downloadWhisperBinary() {
    const assetName = mapPlatformToWhisperAsset();
    if (!assetName) {
      this.logger.warn('[VoiceService] Unsupported platform/arch for whisper auto-download');
      return;
    }
    try {
      const release = await this._fetchJson(WHISPER_GITHUB_API, {
        'User-Agent': 'alpaca/1.0',
        Accept: 'application/vnd.github+json'
      });
      const asset = release.assets && release.assets.find((a) => a.name === assetName);
      if (!asset) {
        this.logger.warn(`[VoiceService] Asset ${assetName} not found in latest whisper.cpp release`);
        return;
      }
      const zipPath = path.join(this.voiceDir, assetName);
      this.logger.log(`[VoiceService] Downloading ${assetName}...`);
      await this._downloadFileWithProgress(asset.browser_download_url, zipPath);
      this.logger.log('[VoiceService] Extracting...');
      await this._extractZip(zipPath, this.voiceDir);
      fs.unlinkSync(zipPath);
      this.whisperBinaryPath = path.join(this.voiceDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    } catch (err) {
      this.logger.warn('[VoiceService] whisper binary auto-download failed:', err.message);
    }
  }

  async _downloadFile(url, destPath, onProgress) {
    try {
      await this._downloadFileWithProgress(url, destPath, onProgress);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _fetchJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : require('http');
      let settled = false;
      const req = client.get(url, { headers }, (res) => {
        if (settled) return;
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (!res.headers.location) { settled = true; reject(new Error('Redirect with no Location')); return; }
          res.resume();
          this._fetchJson(res.headers.location, headers).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) { settled = true; reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
      });
      req.setTimeout(15000, () => {
        if (!settled) { settled = true; req.destroy(); reject(new Error('Request timeout')); }
      });
      setTimeout(() => {
        if (!settled) { settled = true; req.destroy(); reject(new Error('Request hard timeout')); }
      }, 20000);
    });
  }

  _downloadFileWithProgress(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof onProgress !== 'function') onProgress = () => {};
      if (fs.existsSync(destPath)) { try { fs.unlinkSync(destPath); } catch (_) {} }
      const file = fs.createWriteStream(destPath);
      const handleResponse = (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (!response.headers.location) { file.destroy(); fs.unlink(destPath, () => {}); reject(new Error('Redirect with no Location')); return; }
          response.resume();
          https.get(response.headers.location, { headers: { 'User-Agent': 'alpaca/1.0' } }, handleResponse).on('error', err => { file.destroy(); fs.unlink(destPath, () => {}); reject(err); });
          return;
        }
        if (response.statusCode !== 200) { file.destroy(); fs.unlink(destPath, () => {}); reject(new Error(`HTTP ${response.statusCode}`)); return; }
        const total = parseInt(response.headers['content-length'], 10) || 0;
        let current = 0;
        response.on('data', chunk => { current += chunk.length; onProgress(current, total); });
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      };
      https.get(url, { headers: { 'User-Agent': 'alpaca/1.0' } }, handleResponse)
        .on('error', err => { file.destroy(); fs.unlink(destPath, () => {}); reject(err); })
        .setTimeout(300000, () => { file.destroy(); fs.unlink(destPath, () => {}); reject(new Error('Download timeout')); });
    });
  }

  _extractZip(archivePath, destDir) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        const psCommand = `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`;
        const proc = spawn('powershell.exe', ['-Command', psCommand], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          if (code !== 0) reject(new Error(`PowerShell Expand-Archive failed (code ${code}): ${stderr}`));
          else resolve();
        });
      } else {
        const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          if (code !== 0 && code !== 1) reject(new Error(`unzip failed (code ${code}): ${stderr}`));
          else resolve();
        });
      }
    });
  }
}

module.exports = { VoiceService };
