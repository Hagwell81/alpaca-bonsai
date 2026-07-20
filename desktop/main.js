/* eslint-env node */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execSync } = require('child_process');
const Store = require('electron-store');

const binaryManager = require('./binary-manager');
const apiServer = require('./api-server');
const splashManager = require('./splash-manager');
const { createManager: createLazyStartManager } = require('./lazy-start-manager');
const { UserMigration } = require('./user-migration');
const { MigrationDialogManager } = require('./migration-dialog-manager');
const { ApiKeyMigration } = require('./api-key-migration');
const { HuggingFaceModelService } = require('./hf-model-service');
const { VisionPairingManager } = require('./vision-pairing-manager');
const { VoiceService } = require('./voice-service');
const { Scheduler } = require('./scheduler');
const { KnowledgeBase } = require('./knowledge-base');
const { WorkspaceManager } = require('./workspace-manager');
const { KnowledgeBaseMcpServer } = require('./knowledge-base-mcp');
const { LaunchService } = require('./launch-service');
const { IdeConfigGenerator } = require('./ide-config-generator');
const { ImageService } = require('./image-service');
const bonsaiModels = require('./bonsai-models');
const { lookupPreset } = require('./model-preset-db');


const store = new Store();

// Load saved llama.cpp repo preference (bonsai variant vs upstream)
try {
  const savedPref = store.get('llamaCppRepoPreference', null);
  if (savedPref === 'upstream' || savedPref === 'bonsai') {
    binaryManager.setRepoPreference(savedPref);
    console.log(`[main] Loaded llama.cpp repo preference: ${savedPref}`);
  }
} catch (_) { /* ignore */ }

let mainWindow = null;
let tray = null;
let llamaServerProcess = null;
let isServerRunning = false;
let lastMainError = null; // { source: string, message: string, time: string }
let isShuttingDown = false;
let scheduler = null;

app.isQuitting = false;

// ============================================================================
// Hardware Capability Detection
// ============================================================================

/**
 * Detect available compute backends on the local machine.
 * Checks for CUDA, ROCm/HIP, Vulkan, and CPU capabilities.
 * Results are cached in electron-store to avoid repeated probes.
 */
function detectHardwareCapabilities() {
  const capabilities = {
    cuda: false,
    rocm: false,
    vulkan: false,
    cpu: true,
    cpuAVX2: false,
    cpuAVX512: false,
    nvidiaDriverVersion: null,
    amdDriverVersion: null,
    detectedAt: new Date().toISOString()
  };

  if (process.platform === 'win32') {
    // Check for NVIDIA CUDA via nvcuda.dll or nvidia-smi
    try {
      const nvcudaPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvcuda.dll');
      if (fs.existsSync(nvcudaPath)) {
        capabilities.cuda = true;
      }
    } catch (_) { /* ignore */ }

    try {
      const smiOutput = execSync('nvidia-smi --query-gpu=driver_version --format=csv,noheader', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      }).trim();
      if (smiOutput) {
        capabilities.cuda = true;
        capabilities.nvidiaDriverVersion = smiOutput.split('\n')[0].trim();
      }
    } catch (_) { /* nvidia-smi not available */ }

    // Check for AMD ROCm/HIP via amdocl64.dll or amdhdl64.dll
    try {
      const amdPaths = [
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'amdocl64.dll'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'amdhdl64.dll'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'hiprt64.dll')
      ];
      for (const p of amdPaths) {
        if (fs.existsSync(p)) {
          capabilities.rocm = true;
          break;
        }
      }
    } catch (_) { /* ignore */ }

    // Check for Vulkan runtime
    try {
      const vulkanPaths = [
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'vulkan-1.dll')
      ];
      for (const p of vulkanPaths) {
        if (fs.existsSync(p)) {
          capabilities.vulkan = true;
          break;
        }
      }
    } catch (_) { /* ignore */ }

    // Check CPU features via PowerShell (modern) with wmic fallback (deprecated on Win11)
    let cpuInfo = '';
    try {
      cpuInfo = execSync('powershell -Command "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Caption"', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
    } catch (_) {
      try {
        cpuInfo = execSync('wmic cpu get Caption /format:csv', {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true
        });
      } catch (__) { /* ignore */ }
    }
    if (cpuInfo) {
      const upper = cpuInfo.toUpperCase();
      capabilities.cpuAVX2 = upper.includes('AVX2') || upper.includes('CORE I') || upper.includes('RYZEN');
      capabilities.cpuAVX512 = upper.includes('AVX-512') || upper.includes('AVX512');
    }
  } else if (process.platform === 'darwin') {
    // macOS: Metal is the primary GPU backend (GGML_METAL)
    // Apple Silicon always supports Metal
    try {
      const arch = execSync('uname -m', { encoding: 'utf8', timeout: 2000 }).trim();
      if (arch === 'arm64') {
        capabilities.vulkan = true; // Report as Metal-capable via Vulkan fallback if built
      }
    } catch (_) { /* ignore */ }
    try {
      const ioreg = execSync('ioreg -l | grep -i "Metal"', { encoding: 'utf8', timeout: 3000, shell: true });
      if (ioreg && ioreg.trim()) {
        capabilities.vulkan = true;
      }
    } catch (_) { /* ignore */ }
    // More robust GPU detection via system_profiler
    try {
      const gpuInfo = execSync('system_profiler SPDisplaysDataType -detailLevel mini', {
        encoding: 'utf8',
        timeout: 5000
      });
      const upper = gpuInfo.toUpperCase();
      if (upper.includes('NVIDIA') || upper.includes('GEFORCE') || upper.includes('QUADRO')) {
        capabilities.cuda = true;
      }
      if (upper.includes('AMD') || upper.includes('RADEON')) {
        capabilities.rocm = true;
      }
    } catch (_) { /* ignore */ }
  } else {
    // Linux
    try {
      const lspci = execSync('lspci | grep -i nvidia', { encoding: 'utf8', timeout: 3000, shell: true });
      if (lspci && lspci.trim()) capabilities.cuda = true;
    } catch (_) { /* ignore */ }
    try {
      const lspciAmd = execSync('lspci | grep -i "amd\\|advanced micro\\|radeon"', { encoding: 'utf8', timeout: 3000, shell: true });
      if (lspciAmd && lspciAmd.trim()) capabilities.rocm = true;
    } catch (_) { /* ignore */ }
    try {
      const vulkan = execSync('which vulkaninfo', { encoding: 'utf8', timeout: 2000 });
      if (vulkan && vulkan.trim()) capabilities.vulkan = true;
    } catch (_) { /* ignore */ }
    try {
      // Also check for Vulkan loader library as a fallback
      const vulkanLib = execSync('ldconfig -p | grep libvulkan', { encoding: 'utf8', timeout: 2000, shell: true });
      if (vulkanLib && vulkanLib.trim()) capabilities.vulkan = true;
    } catch (_) { /* ignore */ }
    try {
      const cpuInfo = execSync('lscpu', { encoding: 'utf8', timeout: 3000 });
      const upper = cpuInfo.toUpperCase();
      capabilities.cpuAVX2 = upper.includes('AVX2');
      capabilities.cpuAVX512 = upper.includes('AVX-512') || upper.includes('AVX512');
    } catch (_) { /* ignore */ }
  }

  return capabilities;
}

const HARDWARE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isHardwareCacheStale(cached) {
  if (!cached || !cached.detectedAt) return true;
  try {
    const detectedAt = new Date(cached.detectedAt).getTime();
    return Date.now() - detectedAt > HARDWARE_CACHE_TTL_MS;
  } catch (_) {
    return true;
  }
}

function getCachedHardwareCapabilities() {
  const cached = store.get('hardwareCapabilities', null);
  if (cached) return cached;
  const detected = detectHardwareCapabilities();
  store.set('hardwareCapabilities', detected);
  return detected;
}

/**
 * Fast-path hardware capabilities that returns cached data immediately
 * and optionally refreshes in the background.
 */
function getCachedHardwareCapabilitiesFast() {
  const cached = store.get('hardwareCapabilities', null);
  if (cached) return cached;
  const detected = detectHardwareCapabilities();
  store.set('hardwareCapabilities', detected);
  return detected;
}

function getBestBackend() {
  const caps = getCachedHardwareCapabilities();
  if (caps.cuda) return 'cuda';
  if (caps.rocm) return 'rocm';
  if (caps.vulkan) return 'vulkan';
  return 'cpu';
}

function formatHardwareSummary(caps) {
  if (!caps) caps = getCachedHardwareCapabilities();
  const parts = [];
  if (caps.cuda) parts.push(`CUDA (driver ${caps.nvidiaDriverVersion || 'unknown'})`);
  if (caps.rocm) parts.push(`ROCm${caps.amdDriverVersion ? ` (driver ${caps.amdDriverVersion})` : ''}`);
  if (caps.vulkan && !caps.cuda && !caps.rocm) parts.push('Vulkan/Metal');
  if (parts.length === 0) parts.push('CPU');
  return parts.join(', ');
}

/**
 * Compare detected hardware against bundled backend binaries and return
 * an array of user-visible warning strings for any mismatches.
 */
function verifyBackendBinaries() {
  const caps = getCachedHardwareCapabilities();
  const llamaServerBinary = findLlamaServerBinary();
  if (!llamaServerBinary) {
    // Not a fatal error: the app will auto-download the matching llama.cpp
    // backend from the official GitHub releases on first start.
    return ['llama-server not yet installed — the matching llama.cpp backend will be downloaded automatically on first start.'];
  }

  const binDir = path.dirname(llamaServerBinary);
  const warnings = [];

  const hasCudaDll =
    fs.existsSync(path.join(binDir, 'ggml-cuda.dll')) ||
    fs.existsSync(path.join(binDir, 'libggml-cuda.so')) ||
    fs.existsSync(path.join(binDir, 'libggml-cuda.dylib'));
  const hasVulkanDll =
    fs.existsSync(path.join(binDir, 'ggml-vulkan.dll')) ||
    fs.existsSync(path.join(binDir, 'libggml-vulkan.so')) ||
    fs.existsSync(path.join(binDir, 'libggml-vulkan.dylib'));
  const hasRocmDll =
    fs.existsSync(path.join(binDir, 'ggml-hip.dll')) ||
    fs.existsSync(path.join(binDir, 'libggml-hip.so')) ||
    fs.existsSync(path.join(binDir, 'libggml-hip.dylib'));

  if (caps.cuda && !hasCudaDll) {
    warnings.push('NVIDIA GPU detected, but the CUDA backend DLL is missing. Inference will fall back to CPU, which is much slower.');
  }
  if (caps.rocm && !hasRocmDll) {
    warnings.push('AMD GPU detected, but the ROCm/HIP backend DLL is missing. Inference will fall back to CPU, which is much slower.');
  }
  if (caps.vulkan && !caps.cuda && !caps.rocm && !hasVulkanDll) {
    warnings.push('GPU/Metal detected, but the Vulkan backend DLL is missing. Inference will fall back to CPU, which is much slower.');
  }
  return warnings;
}

function generateHardwareBanner() {
  const caps = getCachedHardwareCapabilities();
  const warnings = verifyBackendBinaries();
  const summary = formatHardwareSummary(caps);
  let html = `<div class="hw-banner" style="margin-bottom:20px;padding:12px 16px;border-radius:6px;background:#0d1117;border:1px solid #30363d;text-align:left;">`;
  html += `<div style="font-weight:bold;color:#e6edf3;margin-bottom:6px;">Detected hardware: ${summary}</div>`;
  if (warnings.length > 0) {
    html += `<ul style="margin:0;padding-left:18px;color:#ffcdcd;">`;
    for (const w of warnings) {
      html += `<li style="margin-bottom:4px;">${w}</li>`;
    }
    html += `</ul>`;
  } else {
    html += `<div style="color:#3fb950;font-size:0.9rem;">All required backend binaries are present.</div>`;
  }
  html += `</div>`;
  return html;
}

// Curated list of verified-real GGUF repos hosted on HuggingFace.
// Each entry must point to a file that actually exists; bad URLs leave users
// stranded on the setup screen with no way to recover.
const MODELS_TO_DOWNLOAD = [
  // Bonsai ternary (Ternary-Bonsai) — the canonical bonsai-beach chat models.
  // Listed first so they appear at the top of the onboarding model picker and
  // are pre-checked by default. The 27B variant includes a vision mmproj.
  // URLs point to the public prism-ml HuggingFace mirrors; the canonical
  // bonsai/ternary-bonsai repo is gated and requires a BONSAI_TOKEN.
  {
    name: 'Bonsai 27B (Ternary Q2_0, ~6.8 GB) — chat + vision, recommended for Claude Code',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf/resolve/main/Ternary-Bonsai-27B-Q2_0.gguf',
    filename: 'Ternary-Bonsai-27B-Q2_0.gguf',
    category: 'Bonsai (ternary)',
    mmprojUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-27B-gguf/resolve/main/Ternary-Bonsai-27B-mmproj-Q8_0.gguf',
    mmprojFilename: 'Ternary-Bonsai-27B-mmproj-Q8_0.gguf',
    hasVision: true,
  },
  {
    name: 'Bonsai 8B (Ternary Q2_0, ~2.0 GB) — chat, lighter than 27B',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-8B-gguf/resolve/main/Ternary-Bonsai-8B-Q2_0.gguf',
    filename: 'Ternary-Bonsai-8B-Q2_0.gguf',
    category: 'Bonsai (ternary)',
  },
  // Qwen
  {
    name: 'Qwen3.6-35B-A3B (Q4_K_M, ~22.5 GB)',
    url: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf',
    filename: 'Qwen3.6-35B-A3B-Q4_K_M.gguf',
    category: 'Qwen',
    mmprojUrl: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Qwen3.6-35B-A3B-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'Qwen3.5-9B (Q4_K_M, ~5.7 GB)',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    category: 'Qwen',
    mmprojUrl: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Qwen3.5-9B-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'Qwen3.5-4B (Q4_K_M, ~2.9 GB)',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    category: 'Qwen',
    mmprojUrl: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Qwen3.5-4B-BF16.gguf',
    hasVision: true,
  },
  // Open AI
  {
    name: 'gpt-oss-20b (Q4_K_M, ~14.0 GB)',
    url: 'https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-F16.gguf',
    filename: 'gpt-oss-20b-Q4_K_M.gguf',
    category: 'gpt-oss'
  },

  // Gemma
  {
    name: 'gemma-4-26B-A4B-it (Q4_K_M, ~17.0 GB)',
    url: 'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf',
    filename: 'gemma-4-26B-A4B-it-Q4_K_M.gguf',
    category: 'Gemma',
    mmprojUrl: 'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-gemma-4-26B-A4B-it-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'gemma-4-E4b-it (Q4_K_M, ~6.0 GB)',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    filename: 'gemma-4-E4b-it-Q4_K_M.gguf',
    category: 'Gemma',
    mmprojUrl: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-gemma-4-E4B-it-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'gemma-4-E2b-it (Q4_K_M, ~3.2 GB)',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    filename: 'gemma-4-E2b-it-Q4_K_M.gguf',
    category: 'Gemma',
    mmprojUrl: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-gemma-4-E2B-it-BF16.gguf',
    hasVision: true,
  },
  // Ministral
  {
    name: 'Ministral-3-14B-Reasoning-2512 (Q4_K_M, ~8.4 GB)',
    url: 'https://huggingface.co/unsloth/Ministral-3-14B-Reasoning-2512-GGUF/resolve/main/Ministral-3-14B-Reasoning-2512-Q4_K_M.gguf',
    filename: 'Ministral-3-14B-Reasoning-2512-Q4_K_M.gguf',
    category: 'Ministral',
    mmprojUrl: 'https://huggingface.co/unsloth/Ministral-3-14B-Reasoning-2512-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Ministral-3-14B-Reasoning-2512-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'Ministral-3-8B-Reasoning-2512 (Q4_K_M, ~5.4 GB)',
    url: 'https://huggingface.co/unsloth/Ministral-3-8B-Reasoning-2512-GGUF/resolve/main/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf',
    filename: 'Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf',
    category: 'Ministral',
    mmprojUrl: 'https://huggingface.co/unsloth/Ministral-3-8B-Reasoning-2512-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Ministral-3-8B-Reasoning-2512-BF16.gguf',
    hasVision: true,
  },
  {
    name: 'Ministral-3-3B-Reasoning-2512 (Q4_K_M, ~2.4 GB)',
    url: 'https://huggingface.co/unsloth/Ministral-3-3B-Reasoning-2512-GGUF/resolve/main/Ministral-3-3B-Reasoning-2512-Q4_K_M.gguf',
    filename: 'Ministral-3-3B-Reasoning-2512-Q4_K_M.gguf',
    category: 'Ministral',
    mmprojUrl: 'https://huggingface.co/unsloth/Ministral-3-3B-Reasoning-2512-GGUF/resolve/main/mmproj-BF16.gguf',
    mmprojFilename: 'mmproj-Ministral-3-3B-Reasoning-2512-BF16.gguf',
    hasVision: true,
  },
  // Phi
  {
    name: 'Phi-4-reasoning-plus (Q4_K_M, ~10.0 GB)',
    url: 'https://huggingface.co/unsloth/Phi-4-reasoning-plus-GGUF/resolve/main/Phi-4-reasoning-plus-Q4_K_M.gguf',
    filename: 'Phi-4-reasoning-plus-Q4_K_M.gguf',
    category: 'Phi'
  },
  {
    name: 'Phi-4-mini-reasoning (Q4_K_M, ~2.4 GB)',
    url: 'https://huggingface.co/unsloth/Phi-4-mini-reasoning-GGUF/resolve/main/Phi-4-mini-reasoning-Q4_K_M.gguf',
    filename: 'Phi-4-mini-reasoning-Q4_K_M.gguf',
    category: 'Phi'
  },
  // Small (recommended for first-time users)
  {
    name: 'SmolLM3-3B (Q4_K_M, ~2.5 MB) — fastest',
    url: 'https://huggingface.co/ggml-org/SmolLM3-3B-GGUF/resolve/main/SmolLM3-Q4_K_M.gguf',
    filename: 'SmolLM3-3B-Q4_K_M.gguf',
    category: 'Small'
  },
  // Bonsai 1-bit (Q1_0) — runs on any PC, very low RAM/VRAM
  {
    name: 'Bonsai-8B (1-bit Q1_0, ~1.1 GB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf',
    filename: 'Bonsai-8B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  },
  {
    name: 'Bonsai-4B (1-bit Q1_0, ~570 MB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf',
    filename: 'Bonsai-4B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  },
  {
    name: 'Bonsai-1.7B (1-bit Q1_0, ~250 MB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf',
    filename: 'Bonsai-1.7B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  }
];

function checkModelsExist() {
  const modelsDir = getModelsDirectory();
  console.log('Checking for models in:', modelsDir);

  // 1. Prefer the explicitly active model (set via switch-model) if it is valid.
  const activeModelFilename = store.get('activeModelFilename', null);
  if (activeModelFilename) {
    const activePath = path.join(modelsDir, activeModelFilename);
    if (fs.existsSync(activePath)) {
      const stats = fs.statSync(activePath);
      if (stats.size > 1024 * 1024) {
        console.log(`Valid active model found: ${activeModelFilename}`);
        return activeModelFilename;
      }
    }
  }

  // 2. Check curated/selected list next.
  const modelsToCheck = getSelectedModels();
  for (const model of modelsToCheck) {
    const modelPath = path.join(modelsDir, model.filename);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      if (stats.size > 1024 * 1024) {
        console.log(`Valid curated model found: ${model.filename}`);
        return model.filename;
      }
    }
  }

  // 3. Fallback: scan the whole models directory for ANY valid .gguf file.
  // This is required so that models downloaded via the HuggingFace search
  // (which are not in MODELS_TO_DOWNLOAD) are also detected — without this
  // step the setup UI is shown again immediately after a successful HF
  // download, because the file is invisible to the curated check above.
  if (fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.gguf')) continue;
        if (isMmprojFile(f)) continue; // vision projector, not a base model
        const fp = path.join(modelsDir, f);
        const stats = fs.statSync(fp);
        if (stats.size > 1024 * 1024) {
          console.log(`Valid model found via directory scan: ${f}`);
          return f;
        }
      }
    } catch (err) {
      console.error('Error scanning models directory:', err.message);
    }
  }

  console.log('No valid models found');
  return null;
}

function getHtmlDir() {
  const htmlDir = path.join(app.getPath('userData'), 'html');
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir, { recursive: true });
  }
  return htmlDir;
}

function getSetupHtmlPath() {
  return path.join(getHtmlDir(), 'setup.html');
}

function generateModelOptions() {
  console.log(`generateModelOptions called, MODELS_TO_DOWNLOAD length = ${MODELS_TO_DOWNLOAD ? MODELS_TO_DOWNLOAD.length : 'undefined'}`);
  if (!MODELS_TO_DOWNLOAD || MODELS_TO_DOWNLOAD.length === 0) {
    console.warn('MODELS_TO_DOWNLOAD is empty or undefined');
    return '<p class="subtitle">No models available to download at this time.</p>';
  }
  const categories = {};
  MODELS_TO_DOWNLOAD.forEach(model => {
    const cat = model.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(model);
  });

  let html = '';
  for (const [category, models] of Object.entries(categories)) {
    html += `<div class="category"><div class="category-title">${category}</div>`;
    models.forEach(model => {
      const isBonsaiTernary = model.category === 'Bonsai (ternary)';
      html += `<div class="model-item">`;
      html += `<input type="checkbox" id="${model.name}" name="model" value="${model.name}"${isBonsaiTernary ? ' checked' : ''}>`;
      html += `<label for="${model.name}">${model.name}`;
      if (model.hasVision) {
        html += ` <span class="vision-badge" title="Supports vision / image input">👁</span>`;
      }
      html += `</label>`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  console.log(`generateModelOptions returning ${html.length} chars of HTML`);
  return html;
}

function getAlpacaPngBase64() {
  // In dev __dirname is the desktop folder; in a packaged app it is
  // .../resources/app.asar.  Files in resources/ are bundled inside the
  // asar (fs.readFileSync works on asar paths).  Files in public/ and
  // bin/ are unpacked to app.asar.unpacked/ because external executables
  // must read them from the real filesystem.
  const pngPaths = [
    // Development: source tree media folder
    path.join(__dirname, '..', '..', '..', 'media', 'alpaca.png'),
    // Packaged: inside app.asar/resources/ (bundled by electron-builder)
    path.join(__dirname, 'resources', 'alpaca.png'),
    // Packaged: unpacked resources/ (if ever added to asarUnpack)
    path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'alpaca.png'),
    // Packaged: unpacked public/ (build-webui.js copies media here)
    path.join(__dirname, '..', 'app.asar.unpacked', 'public', 'alpaca.png'),
    // Fallback via process.resourcesPath for non-standard Electron layouts
    path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'alpaca.png'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'alpaca.png'),
    path.join(process.resourcesPath, 'app', 'resources', 'alpaca.png'),
    path.join(process.resourcesPath, 'app', 'public', 'alpaca.png')
  ];
  for (const pngPath of pngPaths) {
    try {
      if (fs.existsSync(pngPath)) {
        return fs.readFileSync(pngPath).toString('base64');
      }
    } catch (_) { /* continue */ }
  }
  return null;
}

let cachedAlpacaPngBase64 = null;
function getCachedAlpacaPngBase64() {
  if (cachedAlpacaPngBase64 === null) {
    cachedAlpacaPngBase64 = getAlpacaPngBase64();
  }
  return cachedAlpacaPngBase64;
}

function getLoadingScreenHtml(title = 'alpaca', message = 'Starting...') {
  const pngBase64 = getCachedAlpacaPngBase64();
  const imgHtml = pngBase64
    ? `<img src="data:image/png;base64,${pngBase64}" alt="alpaca" style="width:120px;height:120px;margin-bottom:20px;object-fit:contain;" />`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
    }
    .logo { margin-bottom: 4px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
    p { font-size: 0.95rem; color: #8b949e; margin-bottom: 24px; }
    .progress-track {
      width: 280px;
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: #667eea;
      border-radius: 2px;
      transition: width 0.4s ease;
    }
  </style>
</head>
<body>
  <div class="logo">${imgHtml}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
  <script>
    (function(){
      var p = 0;
      var el = document.getElementById('progress');
      function tick(){
        p = Math.min(90, p + Math.random() * 8);
        if(el) el.style.width = p + '%';
        if(p < 90) setTimeout(tick, 400 + Math.random() * 400);
      }
      tick();
    })();
  </script>
</body>
</html>`;
}

const LOADING_DATA_URL = `data:text/html,${encodeURIComponent(getLoadingScreenHtml())}`;

function showMainWindowLoading(title = 'alpaca', message = 'Loading...') {
  if (!mainWindow) return;
  // Use the persistent splash screen via IPC instead of reloading the window.
  // This eliminates blank flashes during transitions.
  splashManager.showIndeterminate(title, message);
}

function getSetupHtml(modelOptions = '') {
  const pngBase64 = getCachedAlpacaPngBase64();
  const logoHtml = pngBase64
    ? `<div class="logo"><img src="data:image/png;base64,${pngBase64}" alt="alpaca" style="width:120px;height:120px;object-fit:contain;" /></div>`
    : '<div class="logo" style="font-size:48px;">🦙</div>';
  // The page below is loaded via mainWindow.loadFile() with the same preload
  // script attached, so window.llamaAPI is available. It exposes both the
  // curated model list and a free-form HuggingFace search/download flow so
  // users are never trapped without a way to obtain a model.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>alpaca Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0d1117;
      padding: 20px;
    }
    .container {
      background: #161b22;
      border: 1px solid #30363d;
      padding: 40px;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
      text-align: center;
    }
    .logo {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 8px;
    }
    .logo img {
      width: 120px;
      height: 120px;
      margin-bottom: 16px;
    }
    h1 { color: #e6edf3; margin-bottom: 8px; text-align: center; font-size: 1.6rem; font-weight: 600; letter-spacing: 0.5px; }
    .subtitle { color: #8b949e; font-size: 0.95rem; margin-bottom: 24px; text-align: center; }
    p { color: #8b949e; line-height: 1.6; margin-bottom: 20px; text-align: left; }
    .category {
      margin-bottom: 25px;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 15px;
      background: #0d1117;
    }
    .category-title {
      font-weight: bold;
      color: #e6edf3;
      margin-bottom: 10px;
      font-size: 16px;
      text-align: left;
    }
    .model-item {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      padding: 8px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .model-item:hover {
      background: #1c2128;
    }
    .model-item input[type="checkbox"] {
      margin-right: 10px;
      width: 18px;
      height: 18px;
      accent-color: #667eea;
    }
    .model-item label {
      cursor: pointer;
      flex: 1;
      color: #c9d1d9;
      text-align: left;
    }
    .vision-badge {
      font-size: 12px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .buttons {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      justify-content: center;
    }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.3s;
    }
    button:hover {
      background: #5568d3;
    }
    button.secondary {
      background: #6c757d;
    }
    button.secondary:hover {
      background: #5a6268;
    }
    .error-banner {
      display: none;
      margin-bottom: 20px;
      padding: 12px 16px;
      border-radius: 6px;
      background: #3a1212;
      border: 1px solid #8b3a3a;
      color: #ffcdcd;
      text-align: left;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .error-banner.visible { display: block; }
    .error-banner code { background: #2a0e0e; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
    .error-banner .copy-row {
      margin-top: 8px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .error-banner .copy-row button {
      padding: 6px 12px;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="container">
    ${logoHtml}
    <h1>alpaca</h1>
    <p class="subtitle">Setup — choose at least one model to get started.<br><span style="color:#10a37f;font-size:0.85rem;">First-time installation may take a few minutes. The app will update automatically once ready.</span></p>
    <div id="error-banner" class="error-banner">
      <strong>Startup error:</strong> <span id="error-text"></span>
      <div class="copy-row">
        <button class="secondary" onclick="copyLogPath()">Copy log path</button>
        <span id="copy-status" style="font-size:0.8rem;color:#8b949e;"></span>
      </div>
    </div>
    <p>Pick a curated model below, or paste any HuggingFace GGUF repo to download a custom one. The app will start automatically once a model is ready.</p>

    ${generateHardwareBanner()}

    <h3 style="color:#e6edf3;text-align:left;margin:8px 0 12px;font-size:1rem;">Curated models</h3>
    ${modelOptions || '<p class="subtitle" style="text-align:left;">No models found. Please use the HuggingFace search below.</p>'}
    <div class="buttons">
      <button onclick="downloadSelected()">Download Selected</button>
      <button class="secondary" onclick="selectNone()">Deselect All</button>
      <button class="secondary" onclick="selectAll()">Select All</button>
    </div>

    <div class="category hf-section" style="margin-top:24px;">
      <div class="category-title">Or download any GGUF from HuggingFace</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="hf-repo" placeholder="author/model-name (e.g. bartowski/Llama-3.2-3B-Instruct-GGUF)"
               style="flex:1;padding:10px;border-radius:5px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:14px;" />
        <button onclick="searchHF()">Search</button>
      </div>
      <input id="hf-token" type="password" placeholder="HuggingFace token (optional, for gated models)"
             style="width:100%;padding:10px;border-radius:5px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:13px;margin-bottom:8px;" />
      <div id="hf-results" style="text-align:left;color:#c9d1d9;font-size:13px;"></div>
    </div>

    <div class="category" style="margin-top:24px;">
      <div class="category-title">Import an existing model</div>
      <p style="text-align:left;font-size:13px;margin-bottom:12px;">Already have a GGUF file on your computer? Import it directly without downloading.</p>
      <div style="display:flex;gap:8px;">
        <button class="secondary" style="flex:1;padding:10px;font-size:14px;" onclick="importLocalModelSetup()">Import Local Model</button>
        <button class="secondary" style="flex:1;padding:10px;font-size:14px;" onclick="importVisionModelSetup()">Import Vision Model</button>
      </div>
    </div>
  </div>

  <script>
    function selectAll() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = true);
    }
    function selectNone() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = false);
    }

    function showProgress(msg) {
      let el = document.getElementById('progress-area');
      if (!el) {
        el = document.createElement('div');
        el.id = 'progress-area';
        el.style.cssText = 'margin-top:24px;padding:16px;border-radius:8px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;font-family:monospace;white-space:pre-wrap;text-align:left;';
        document.querySelector('.container').appendChild(el);
      }
      el.textContent = msg;
    }

    function hideSelectionUI() {
      document.querySelector('.buttons').style.display = 'none';
      document.querySelectorAll('.category').forEach(c => { if (!c.classList.contains('hf-section')) c.style.display = 'none'; });
    }

    async function downloadSelected() {
      try {
        const selected = Array.from(document.querySelectorAll('input[name="model"]:checked')).map(cb => cb.value);
        if (selected.length === 0) {
          alert('Please select at least one model to download, or use the HuggingFace search below.');
          return;
        }
        if (!window.llamaAPI || !window.llamaAPI.setSelectedModels || !window.llamaAPI.downloadModels) {
          alert('App bridge not available. Please restart the application.');
          return;
        }
        await window.llamaAPI.setSelectedModels(selected);
        await window.llamaAPI.downloadModels();
        hideSelectionUI();
        showProgress('Download started... Fetching progress...');
        pollUntilDone();
      } catch (err) {
        alert('Error starting download: ' + (err && err.message ? err.message : String(err)));
        console.error('downloadSelected error:', err);
      }
    }

    async function showLastError() {
      try {
        if (!window.llamaAPI || !window.llamaAPI.getLastError) return;
        const err = await window.llamaAPI.getLastError();
        if (err && err.message) {
          const banner = document.getElementById('error-banner');
          const text = document.getElementById('error-text');
          if (banner && text) {
            text.textContent = '(' + err.source + ') ' + err.message;
            banner.classList.add('visible');
          }
        }
      } catch (_) { /* ignore */ }
    }

    async function copyLogPath() {
      try {
        if (!window.llamaAPI || !window.llamaAPI.copyLogPath) return;
        const result = await window.llamaAPI.copyLogPath();
        const status = document.getElementById('copy-status');
        if (status) status.textContent = result.success ? 'Copied!' : ('Failed: ' + (result.error || ''));
      } catch (e) {
        const status = document.getElementById('copy-status');
        if (status) status.textContent = 'Failed to copy';
      }
    }

    showLastError();

    async function searchHF() {
      const repo = document.getElementById('hf-repo').value.trim();
      const token = document.getElementById('hf-token').value.trim();
      const resultsEl = document.getElementById('hf-results');
      if (!repo) { resultsEl.textContent = 'Enter a repo id like author/model-name.'; return; }
      if (!window.llamaAPI || !window.llamaAPI.searchHuggingFace) {
        resultsEl.textContent = 'HuggingFace search is unavailable in this build.';
        return;
      }
      resultsEl.textContent = 'Searching ' + repo + '...';
      try {
        const r = await window.llamaAPI.searchHuggingFace(repo, token || undefined);
        if (!r || r.error) { resultsEl.textContent = 'Error: ' + (r && r.error ? r.error : 'Unknown error'); return; }
        const files = (r.modelFiles && r.modelFiles.length ? r.modelFiles : (r.ggufFiles || []));
        if (files.length === 0) { resultsEl.textContent = 'No GGUF files found in ' + r.repoId + '.'; return; }
        resultsEl.innerHTML = '';
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom:8px;color:#8b949e;';
        header.textContent = r.repoId + ' — ' + files.length + ' GGUF file(s):';
        resultsEl.appendChild(header);
        files.forEach(f => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid #30363d;border-radius:4px;margin-bottom:6px;background:#161b22;';
          const label = document.createElement('span');
          label.style.cssText = 'flex:1;margin-right:8px;word-break:break-all;';
          label.textContent = f.filename + (f.sizeFormatted ? '  (' + f.sizeFormatted + ')' : '');
          const btn = document.createElement('button');
          btn.textContent = 'Download';
          btn.style.cssText = 'padding:6px 12px;font-size:13px;';
          btn.onclick = () => downloadHF(r.repoId, f.filename, token);
          row.appendChild(label);
          row.appendChild(btn);
          resultsEl.appendChild(row);
        });
      } catch (err) {
        resultsEl.textContent = 'Search failed: ' + (err && err.message ? err.message : String(err));
      }
    }

    async function downloadHF(repoId, filename, token) {
      if (!window.llamaAPI || !window.llamaAPI.downloadHuggingFaceModel) {
        alert('Download API unavailable.');
        return;
      }
      try {
        await window.llamaAPI.downloadHuggingFaceModel(repoId, filename, token || undefined);
        hideSelectionUI();
        document.querySelector('.hf-section').style.display = 'none';
        showProgress('Downloading ' + filename + ' from ' + repoId + '...');
        pollUntilDone();
      } catch (err) {
        alert('Error starting download: ' + (err && err.message ? err.message : String(err)));
      }
    }

    async function pollUntilDone() {
      const api = window.llamaAPI;
      if (!api || !api.getAllDownloadProgress) {
        showProgress('Progress API not available.');
        return;
      }
      let waitedForFirstEntry = 0;
      const poll = async () => {
        try {
          const list = await api.getAllDownloadProgress();
          // Backend now returns an array; tolerate object form too just in case.
          const entries = Array.isArray(list)
            ? list.map(e => [e.downloadId, e])
            : Object.entries(list || {});
          if (entries.length === 0) {
            // Wait up to 30s for the download to register before warning.
            waitedForFirstEntry += 2000;
            if (waitedForFirstEntry >= 30000) {
              showProgress('No active downloads detected. The request may have failed silently — check console.');
              return;
            }
            showProgress('Waiting for download to start...');
            setTimeout(poll, 2000);
            return;
          }
          const lines = entries.map(([id, v]) => {
            const pct = v.total ? Math.round((v.current / v.total) * 100) : 0;
            const mb = v.current ? (v.current / 1024 / 1024).toFixed(1) : '0';
            const totalMb = v.total ? (v.total / 1024 / 1024).toFixed(1) : '?';
            const status = v.status || 'pending';
            return id + ': ' + status + ' ' + pct + '% (' + mb + ' / ' + totalMb + ' MB)' + (v.error ? ' — ' + v.error : '');
          });
          showProgress(lines.join('\\n'));
          const allDone = entries.every(([_, v]) => v.status === 'completed' || v.status === 'error');
          if (allDone) {
            const hasSuccess = entries.some(([_, v]) => v.status === 'completed');
            if (!hasSuccess) {
              showProgress('All downloads failed.\\n\\n' + lines.join('\\n') + '\\n\\nPick another model above or paste a different HuggingFace repo to retry.');
              // Re-show UI so user can try again
              const buttons = document.querySelector('.buttons');
              if (buttons) buttons.style.display = 'flex';
              document.querySelectorAll('.category').forEach(c => c.style.display = '');
              return;
            }
            showProgress('Downloads complete. Starting app...');
            setTimeout(async () => {
              if (api.goBackToMain) {
                await api.goBackToMain();
              } else {
                location.reload();
              }
            }, 1200);
            return;
          }
          setTimeout(poll, 2000);
        } catch (err) {
          showProgress('Error checking progress: ' + (err && err.message ? err.message : String(err)));
          setTimeout(poll, 3000);
        }
      };
      poll();
    }

    async function importLocalModelSetup() {
      if (!window.llamaAPI || !window.llamaAPI.importLocalModel) {
        alert('Import API not available.');
        return;
      }
      try {
        const result = await window.llamaAPI.importLocalModel();
        if (result.canceled) return;
        if (result.success) {
          showProgress('Imported ' + result.filename + ' (' + result.sizeFormatted + '). Starting app...');
          setTimeout(async () => {
            if (window.llamaAPI && window.llamaAPI.goBackToMain) {
              await window.llamaAPI.goBackToMain();
            } else {
              location.reload();
            }
          }, 1200);
        } else {
          alert('Import failed: ' + (result.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Import failed: ' + (err && err.message ? err.message : String(err)));
      }
    }

    async function importVisionModelSetup() {
      if (!window.llamaAPI || !window.llamaAPI.importVisionModel) {
        alert('Import API not available.');
        return;
      }
      try {
        const result = await window.llamaAPI.importVisionModel();
        if (result.canceled) return;
        if (result.success) {
          showProgress('Imported vision model ' + result.filename + ' + ' + result.mmprojFilename + '. Starting app...');
          setTimeout(async () => {
            if (window.llamaAPI && window.llamaAPI.goBackToMain) {
              await window.llamaAPI.goBackToMain();
            } else {
              location.reload();
            }
          }, 1200);
        } else {
          alert('Import failed: ' + (result.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Import failed: ' + (err && err.message ? err.message : String(err)));
      }
    }
  </script>
</body>
</html>`;
}

function loadSettingsWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow();
  }
  const settingsHtmlPath = path.join(__dirname, 'settings.html');
  if (fs.existsSync(settingsHtmlPath) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(settingsHtmlPath);
    mainWindow.show();
    mainWindow.focus();
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'alpaca',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false
    },
    icon: path.join(__dirname, 'resources', 'alpaca.png')
  });

  // Remove the default application menu (File, Edit, View, Window)
  // Set up application menu with Help > Documentation
  const appMenu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'Ctrl+N',
          click: () => {
            mainWindow.webContents.executeJavaScript(`
              if (window.app) window.app.newChat();
            `);
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'Ctrl+,',
          click: () => {
            loadSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Ctrl+Q',
          click: () => { quitApplication(); }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Ctrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Server',
      submenu: [
        {
          label: 'Start Server',
          click: async () => { await startLlamaServer(); },
          enabled: !isServerRunning
        },
        {
          label: 'Stop Server',
          click: async () => { await stopLlamaServer(); },
          enabled: isServerRunning
        },
        { type: 'separator' },
        {
          label: 'View Service Logs',
          click: () => {
            openServiceLogsWindow();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          accelerator: 'Ctrl+Shift+?',
          click: () => {
            openDocumentationWindow();
          }
        },
        {
          label: 'API Reference',
          click: () => {
            // `/docs/api` is a category page with no direct index.html;
            // link to the REST API reference which does.
            openDocumentationWindow('/docs/api/rest-api');
          }
        },
        {
          label: 'Getting Started',
          click: () => {
            openDocumentationWindow('/docs/getting-started');
          }
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => {
            mainWindow.webContents.executeJavaScript(`
              if (window.app) window.app.checkForUpdates();
            `);
          }
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Alpaca',
              message: 'Alpaca',
              detail: `Version: ${app.getVersion() || '1.0.0'}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}\nChromium: ${process.versions.chrome}`
            });
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(appMenu);

  // Load the persistent splash screen from the public directory.
  // The splash listens for IPC updates so we never reload the window
  // during startup, eliminating blank flashes.
  const splashPath = path.join(__dirname, 'public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    mainWindow.loadFile(splashPath);
  } else {
    mainWindow.loadURL(LOADING_DATA_URL);
  }
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      splashManager.bindWindow(mainWindow);
      splashManager.sendSplashLogo(path.join(__dirname, 'resources'));
    }
  });

  // Hard safety net: if the startup sequence hangs for any reason
  // (zombie port, model load stuck, etc.), show the setup screen so
  // the user is never trapped on a blank loading page.
  let startupCompleted = false;
  const startupGuardTimer = setTimeout(() => {
    if (!startupCompleted && mainWindow && !mainWindow.isDestroyed()) {
      console.warn('[createWindow] Startup guard triggered — loading setup screen after 180s');
      const setupHtmlPath = getSetupHtmlPath();
      const setupHtml = getSetupHtml(generateModelOptions());
      try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (e) { /* ignore */ }
      if (fs.existsSync(setupHtmlPath)) {
        mainWindow.loadFile(setupHtmlPath);
      }
    }
  }, 180000);

  // Check if models exist before loading webui
  const validModel = checkModelsExist();
  if (validModel) {
    console.log(`Loading webui with model: ${validModel}`);

    const lazyStartMgr = createLazyStartManager(store);
    if (lazyStartMgr.isEnabled()) {
      // Lazy-start: keep RAM free until the user explicitly activates the AI.
      // Show a landing page with a "Start Chatting" button.
      console.log('[createWindow] Lazy-start enabled — showing landing page');
      const caps = getCachedHardwareCapabilities();
      const backendName = binaryManager.mapCapabilitiesToBackend(caps);
      const landingHtml = lazyStartMgr.generateLandingPage({
        logoHtml: getCachedAlpacaPngBase64()
          ? `<img src="data:image/png;base64,${getCachedAlpacaPngBase64()}" alt="alpaca" style="width:120px;height:120px;object-fit:contain;" />`
          : undefined,
        modelName: validModel,
        backendName: formatHardwareSummary(caps)
      });
      const landingPath = path.join(getHtmlDir(), 'landing.html');
      try { fs.writeFileSync(landingPath, landingHtml); } catch (e) { /* ignore */ }
      if (fs.existsSync(landingPath)) {
        mainWindow.loadFile(landingPath);
      }
      startupCompleted = true;
      clearTimeout(startupGuardTimer);
      return;
    }

    // If backend preload is still running, wait for it before starting server
    // so the user doesn't see a silent hang.
    if (backendPreloadPromise && !isServerRunning) {
      const caps = getCachedHardwareCapabilities();
      const backendName = binaryManager.mapCapabilitiesToBackend(caps);
      const backendDownloadId = `__backend__/${backendName}`;
      const beProgress = downloadProgress.get(backendDownloadId);
      if (beProgress && (beProgress.status === 'downloading' || beProgress.status === 'extracting')) {
        showMainWindowLoading('alpaca', `Downloading llama.cpp backend (${backendName})…`);
        try {
          await backendPreloadPromise;
        } catch (err) {
          console.error('[createWindow] Backend preload failed:', err.message);
        }
      }
    }

    // Auto-start llama-server when models are available
    const serverStarted = await startLlamaServer();
    if (!serverStarted) {
      // Server failed to start (binary or model missing), show setup
      console.error('Failed to start llama-server, showing setup screen');
      const setupHtmlPath = getSetupHtmlPath();
      const setupHtml = getSetupHtml(generateModelOptions());
      try {
        fs.writeFileSync(setupHtmlPath, setupHtml);
      } catch (err) {
        console.error('Failed to write setup.html to userData:', err.message);
      }
      if (fs.existsSync(setupHtmlPath)) {
        mainWindow.loadFile(setupHtmlPath);
      }
      startupCompleted = true;
      clearTimeout(startupGuardTimer);
    } else {
      // Wait for server to be ready before loading webui
      const apiUrl = apiServer.getApiUrl();
      const apiCfg = apiServer.getApiConfig();
      const serverPort = apiCfg.port || 13434;

      // Inform the user that the model is loading — large models on slow
      // drives can take 30–90 seconds before the HTTP server comes up.
      showMainWindowLoading('alpaca', 'Loading AI model, this may take a moment...');

      waitForServerReady(`${apiUrl}/`)
        .then(() => {
          console.log('Server is ready, loading webui...');
          showMainWindowLoading('alpaca', 'Launching chat...');
          mainWindow.loadURL(apiUrl);
          startupCompleted = true;
          clearTimeout(startupGuardTimer);
        })
        .catch(async (err) => {
          console.error('Server failed to start:', err.message);
          // Force-kill any orphan and retry once
          killProcessOnPort(serverPort);
          try {
            const retryStarted = await startLlamaServer();
            if (retryStarted) {
              await waitForServerReady(`${apiUrl}/`, 30000);
              console.log('Server ready after retry, loading webui...');
              showMainWindowLoading('alpaca', 'Launching chat...');
              mainWindow.loadURL(apiUrl);
              startupCompleted = true;
              clearTimeout(startupGuardTimer);
              return;
            }
          } catch (retryErr) {
            console.error('Server retry failed:', retryErr.message);
          }
          // Fallback: show setup screen so the user is never trapped
          const setupHtmlPath = getSetupHtmlPath();
          const setupHtml = getSetupHtml(generateModelOptions());
          try {
            fs.writeFileSync(setupHtmlPath, setupHtml);
          } catch (writeErr) {
            console.error('Failed to write setup.html to userData:', writeErr.message);
          }
          if (fs.existsSync(setupHtmlPath)) {
            mainWindow.loadFile(setupHtmlPath);
          }
          startupCompleted = true;
          clearTimeout(startupGuardTimer);
        });
    }
  } else {
    // Show setup screen with model selection
    const setupHtmlPath = getSetupHtmlPath();
    const setupHtml = getSetupHtml(generateModelOptions());
    try {
      fs.writeFileSync(setupHtmlPath, setupHtml);
    } catch (err) {
      console.error('Failed to write setup.html to userData:', err.message);
    }
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    } else {
      mainWindow.loadURL(LOADING_DATA_URL);
    }
    startupCompleted = true;
    clearTimeout(startupGuardTimer);
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      if (!mainWindow.isDestroyed()) mainWindow.hide();

      // Show notification that app is running in tray
      if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'alpaca',
          content: 'App is running in the system tray. Click the tray icon to restore.'
        });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// TUI (Terminal UI) launch support
//
// The alpaca-tui is a Rust/ratatui binary that provides a terminal interface
// for model management and chat. It connects to a control API (bonsai-beach
// supervisor on port 15450, or can be pointed at another endpoint).
//
// The TUI binary is discovered in this order:
//   1. Bundled alongside the desktop app (resources/tui/alpaca-tui)
//   2. Development build at tui/target/release/alpaca-tui[.exe]
//   3. User-installed location (PATH)
//
// The TUI is launched in a new terminal window so it has a proper TTY.
// The workspace folder from the desktop's WorkspaceManager is passed via
// --workspace so the TUI can use the same workspace without re-configuring.
// ============================================================================

/**
 * Find the alpaca-tui binary on disk.
 * @returns {string|null} Path to the TUI binary, or null if not found.
 */
function findTuiBinary() {
  const exe = process.platform === 'win32' ? 'alpaca-tui.exe' : 'alpaca-tui';

  // 1. Packaged app with asarUnpack: binary in app.asar.unpacked/resources/tui/
  const unpacked = path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'tui', exe);
  if (fs.existsSync(unpacked)) return unpacked;

  // 2. Packaged app via process.resourcesPath
  const resourcesTui = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tui', exe);
  if (fs.existsSync(resourcesTui)) return resourcesTui;

  // 3. Bundled alongside desktop app (non-asar dev/test)
  const bundled = path.join(__dirname, 'resources', 'tui', exe);
  if (fs.existsSync(bundled)) return bundled;

  // 4. Development build (tui/target/release/)
  const devBuild = path.join(__dirname, '..', 'tui', 'target', 'release', exe);
  if (fs.existsSync(devBuild)) return devBuild;

  // 5. Not found
  return null;
}

/**
 * Launch the alpaca-tui in a new terminal window.
 *
 * @param {Object} [opts] - Launch options
 * @param {string} [opts.controlUrl] - Control API URL (default: desktop llama-server port 13434)
 * @param {string} [opts.workspace] - Workspace folder path to pass to TUI
 * @param {string} [opts.model] - Default model ID (default: bonsai-27b)
 * @returns {Promise<{success: boolean, error?: string, binaryPath?: string}>}
 */
async function launchTui(opts = {}) {
  const tuiPath = findTuiBinary();
  if (!tuiPath) {
    const msg = 'alpaca-tui binary not found. Build it with: cd tui && cargo build --release';
    console.error('[tui]', msg);
    return { success: false, error: msg };
  }

  // Build CLI arguments for the TUI
  const controlUrl = opts.controlUrl || 'http://127.0.0.1:13439';
  const model = opts.model || 'bonsai-27b';
  const tuiArgs = ['--control', controlUrl, '--model', model];
  if (opts.workspace) {
    tuiArgs.push('--workspace', opts.workspace);
  }

  console.log(`[tui] Launching: ${tuiPath} ${tuiArgs.join(' ')}`);

  try {
    // Launch in a new terminal window so the TUI has a proper TTY.
    // Platform-specific terminal launch:
    if (process.platform === 'win32') {
      // Windows: use `start` to open a new cmd window running the TUI.
      // The first quoted argument to `start` is the window title.
      // Without it, `start` treats the first arg as the command to run,
      // causing "Windows cannot find 'alpaca-tui'" errors.
      const { spawn } = require('child_process');
      const quotedArgs = tuiArgs.map(a => `"${a}"`).join(' ');
      spawn('cmd.exe', ['/c', 'start', '"alpaca-tui"', `"${tuiPath}"`, quotedArgs], {
        detached: true,
        shell: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      // macOS: use Terminal.app via osascript
      const { exec } = require('child_process');
      const cmd = `${tuiPath} ${tuiArgs.map(a => `'${a}'`).join(' ')}`;
      const script = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { detached: true }).unref();
    } else {
      // Linux: try common terminal emulators
      const { spawn } = require('child_process');
      const terminals = ['gnome-terminal', 'konsole', 'xterm', 'xfce4-terminal'];
      const cmd = `${tuiPath} ${tuiArgs.map(a => `'${a}'`).join(' ')}`;
      for (const term of terminals) {
        try {
          spawn(term, ['-e', 'bash', '-c', cmd], {
            detached: true,
            stdio: 'ignore',
          }).unref();
          break;
        } catch (_) { /* try next */ }
      }
    }

    return { success: true, binaryPath: tuiPath };
  } catch (err) {
    console.error('[tui] Failed to launch:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Safely show and focus the main window, recreating it if the previous
 * BrowserWindow has been destroyed.
 *
 * The close-to-tray flow hides the window instead of destroying it, but the
 * underlying BrowserWindow can still be destroyed by external triggers
 * (OS cleanup, `quitApplication`, `cleanupBeforeExit`, or a race between
 * the 'closed' event and a tray click). Calling `mainWindow.show()` on a
 * destroyed window throws `TypeError: Object has been destroyed`, which
 * was the crash users saw when re-opening the app from the tray.
 *
 * This helper is the single safe entry point for "bring the window to the
 * front" used by the tray menu, tray double-click, and second-instance
 * handlers.
 */
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow = null;
    createWindow();
  }
}

function createTray() {
  // Create tray icon
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, 'resources', 'alpaca.ico');
  } else {
    iconPath = path.join(__dirname, 'resources', 'alpaca.png');
  }

  // If icon doesn't exist, create a simple one
  if (!fs.existsSync(iconPath)) {
    const nativeIcon = nativeImage.createEmpty();
    tray = new Tray(nativeIcon);
  } else {
    tray = new Tray(iconPath);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Alpaca',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        loadSettingsWindow();
      }
    },
    {
      label: 'Server',
      submenu: [
        {
          label: isServerRunning ? 'Status: Running' : 'Status: Stopped',
          enabled: false
        },
        {
          label: 'Start Server',
          click: async () => { await startLlamaServer(); },
          enabled: !isServerRunning
        },
        {
          label: 'Stop Server',
          click: async () => { await stopLlamaServer(); },
          enabled: isServerRunning
        },
        { type: 'separator' },
        {
          label: 'Check for Server Update',
          click: async () => {
            try {
              const info = getCurrentBackendInfo();
              const release = await binaryManager.getLatestReleaseInfo();
              const currentNum = parseInt(String(info.tag || '').replace(/\D/g, ''), 10) || 0;
              const latestNum = parseInt(String(release.tag).replace(/\D/g, ''), 10) || 0;

              if (info.tag && latestNum <= currentNum) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'alpaca',
                  message: 'No update available',
                  detail: `You are already running the latest llama.cpp backend (${info.tag}).`
                });
                return;
              }

              const confirm = await dialog.showMessageBox({
                type: 'question',
                buttons: ['Download & Install', 'Cancel'],
                defaultId: 0,
                title: 'alpaca',
                message: `llama.cpp ${release.tag} is available`,
                detail: `Current: ${info.tag || 'not installed'}\nLatest: ${release.tag}\n\nInstall the update and restart the server?`
              });

              if (confirm.response !== 0) return;

              // Perform the update
              const result = await binaryManager.ensureBackend(app, getCachedHardwareCapabilities(), (currentBytes, total) => {
                const pct = total ? Math.round((currentBytes / total) * 100) : 0;
                console.log(`[binary-manager] Update download progress: ${pct}%`);
              });

              const wasRunning = isServerRunning && !!llamaServerProcess;
              if (wasRunning) {
                const apiCfg = apiServer.getApiConfig();
                const serverPort = apiCfg.port || 13434;
                const apiUrl = apiServer.getApiUrl();
                await stopLlamaServer(15000);
                killProcessOnPort(serverPort);
                try { await waitForPortFree(serverPort, 10000); } catch (e) {
                  killProcessOnPort(serverPort);
                  await waitForPortFree(serverPort, 10000);
                }
                const started = await startLlamaServer();
                if (started) {
                  await waitForServerReady(`${apiUrl}/`, 120000);
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    const currentUrl = mainWindow.webContents.getURL();
                    if (currentUrl.startsWith(apiUrl)) mainWindow.webContents.reload();
                  }
                }
              }

              dialog.showMessageBox({
                type: 'info',
                title: 'alpaca',
                message: 'Update installed',
                detail: wasRunning
                  ? `Updated to ${result.tag} and restarted the server.`
                  : `Updated to ${result.tag}. The new version will be used on next server start.`
              });
            } catch (err) {
              console.error('[tray] Update check failed:', err.message);
              dialog.showErrorBox('Update failed', err.message);
            }
          }
        }
      ]
    },
    {
      label: 'View Service Logs',
      submenu: [
        {
          label: 'Open Service Logs',
          click: () => {
            openServiceLogsWindow();
          }
        },
        { type: 'separator' },
        {
          label: apiServer.getApiConfig().enabled ? `Endpoint: ${apiServer.getApiOpenAIEndpoint()}` : 'API: Disabled',
          enabled: false
        },
        {
          label: 'Copy OpenAI Endpoint',
          click: () => {
            const endpoint = apiServer.getApiOpenAIEndpoint();
            if (endpoint) {
              clipboard.writeText(endpoint);
              console.log('Copied OpenAI endpoint to clipboard:', endpoint);
            }
          },
          enabled: apiServer.getApiConfig().enabled && isServerRunning
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Documentation',
      submenu: [
        {
          label: 'Open Documentation',
          click: () => {
            openDocumentationWindow();
          }
        },
        {
          label: 'API Reference',
          click: () => {
            // `/docs/api` is a category page with no direct index.html;
            // link to the REST API reference which does.
            openDocumentationWindow('/docs/api/rest-api');
          }
        },
        {
          label: 'Getting Started',
          click: () => {
            openDocumentationWindow('/docs/getting-started');
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Open Terminal UI',
      click: async () => {
        // Launch the alpaca-tui with the current workspace folder (if configured)
        const workspaceFolder = global.workspaceManager
          ? global.workspaceManager.getState().activeFolder
          : null;
        const result = await launchTui({ workspace: workspaceFolder || undefined });
        if (!result.success) {
          dialog.showMessageBox({
            type: 'warning',
            title: 'alpaca',
            message: 'Could not launch Terminal UI',
            detail: result.error || 'The alpaca-tui binary was not found. Build it with: cd tui && cargo build --release',
            buttons: ['OK']
          });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { quitApplication(); }
    }
  ]);

  tray.setToolTip('alpaca');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    showMainWindow();
  });
}


/**
 * Extract the last meaningful line from the stderr buffer for UI display.
 */
function getLastStderrStatus(stderrBuffer) {
  if (!stderrBuffer || stderrBuffer.length === 0) return null;
  const tail = stderrBuffer.slice(-3).join('');
  const lines = tail.split('\n').filter(l => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) return null;
  // Filter out noisy lines and return user-friendly status
  const text = last.trim();
  if (text.includes('load') || text.includes('tensor')) {
    return 'Loading model weights into memory...';
  }
  if (text.includes('HTTP') || text.includes('server') || text.includes('port')) {
    return 'Starting inference server...';
  }
  if (text.includes('error') || text.includes('Error')) {
    return 'Preparing AI engine...';
  }
  return 'Preparing AI engine...';
}

/**
 * Start a periodic splash update while the model loads.
 * Returns a function to stop the watcher.
 */
function startModelLoadProgressWatcher(stderrBuffer, startTimeMs) {
  const intervalMs = 2000;
  let lastElapsedSec = 0;
  const timer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);
    if (elapsedSec === lastElapsedSec) return;
    lastElapsedSec = elapsedSec;
    const status = getLastStderrStatus(stderrBuffer) || 'Loading AI model...';
    const message = `${status} (${elapsedSec}s)`;
    splashManager.updateSplash('alpaca', message);
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

async function startLlamaServer(forceCpuBackend = false) {
  console.log('[startLlamaServer] Called. llamaServerProcess exists:', !!llamaServerProcess, 'forceCpuBackend:', forceCpuBackend);
  const apiCfg = apiServer.getApiConfig();
  const serverPort = apiCfg.port || 13434;

  if (llamaServerProcess) {
    try {
      process.kill(llamaServerProcess.pid, 0);
      console.log('llama-server is already running (PID:', llamaServerProcess.pid, ')');
      return true;
    } catch (e) {
      console.log('llama-server process is dead, clearing stale reference');
      llamaServerProcess = null;
      isServerRunning = false;
    }
  }

  // Ensure no zombie server is holding the port
  killProcessOnPort(serverPort);

  // Wait for the OS to release the port
  try {
    console.log(`[startLlamaServer] Waiting for port ${serverPort} to be free...`);
    await waitForPortFree(serverPort, 10000);
    console.log(`[startLlamaServer] Port ${serverPort} is free.`);
  } catch (e) {
    const errMsg = `[startLlamaServer] Port ${serverPort} did not become free in time`;
    lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
    console.error(errMsg);
    return false;
  }

  let llamaServerBinary = findLlamaServerBinary();

  // If no bundled binary exists, try to download the correct backend from GitHub releases
  if (!llamaServerBinary) {
    try {
      console.log('[startLlamaServer] No bundled llama-server found; downloading backend...');
      const caps = forceCpuBackend
        ? { ...getCachedHardwareCapabilities(), cuda: false, vulkan: false, rocm: false }
        : getCachedHardwareCapabilities();
      const backendName = binaryManager.mapCapabilitiesToBackend(caps);
      const backendDownloadId = `__backend__/${backendName}`;

      const result = await binaryManager.ensureBackend(app, caps,
        (current, total) => {
          const pct = total ? Math.round((current / total) * 100) : 0;
          downloadProgress.set(backendDownloadId, {
            status: 'downloading',
            progress: total ? current / total : 0,
            total,
            current,
          });
          console.log(`[binary-manager] Download progress: ${pct}% (${(current / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`);
        },
        (status) => {
          if (status.phase === 'downloading') {
            downloadProgress.set(backendDownloadId, { status: 'downloading', progress: 0, total: 0, current: 0 });
          } else if (status.phase === 'extracting') {
            downloadProgress.set(backendDownloadId, { status: 'extracting', progress: 0, total: 0, current: 0 });
          } else if (status.phase === 'ready') {
            downloadProgress.set(backendDownloadId, { status: 'completed', progress: 1, total: 1, current: 1 });
          } else if (status.phase === 'error') {
            downloadProgress.set(backendDownloadId, { status: 'error', error: status.error });
          }
        }
      );
      llamaServerBinary = result.exePath;
      downloadProgress.set(backendDownloadId, { status: 'completed', progress: 1, total: 1, current: 1 });
      console.log(`[startLlamaServer] Using downloaded backend: ${llamaServerBinary}`);
    } catch (err) {
      const errMsg = `Failed to download llama-server backend: ${err.message}`;
      lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
      console.error(errMsg);
      return false;
    }
  }

  if (!llamaServerBinary) {
    const errMsg = 'llama-server binary not found. The app package may be incomplete.';
    lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
    console.error(errMsg);
    return false;
  }

  const modelsDir = getModelsDirectory();

  // Check for explicitly set active model first
  let modelPath = null;
  const activeModelFilename = store.get('activeModelFilename', null);
  if (activeModelFilename) {
    const activeModelPath = path.join(modelsDir, activeModelFilename);
    if (fs.existsSync(activeModelPath)) {
      const stats = fs.statSync(activeModelPath);
      if (stats.size > 1024 * 1024) {
        modelPath = activeModelPath;
        console.log(`Using active model: ${activeModelFilename}`);
      }
    }
  }

  // Fall back to scanning the curated/selected list
  if (!modelPath) {
    const modelsToCheck = getSelectedModels();
    for (const model of modelsToCheck) {
      const currentModelPath = path.join(modelsDir, model.filename);
      if (fs.existsSync(currentModelPath)) {
        const stats = fs.statSync(currentModelPath);
        if (stats.size > 1024 * 1024) {
          modelPath = currentModelPath;
          console.log(`Using model: ${model.filename}`);
          // Persist the active model so vision/mmproj detection works
          // (getActiveModel IPC handler and mmproj lookup both rely on this)
          store.set('activeModelFilename', model.filename);
          if (model.mmprojFilename) {
            store.set('activeModelMmprojFilename', model.mmprojFilename);
          }
          break;
        }
      }
    }
  }

  // Final fallback: scan the whole models directory for ANY valid .gguf file.
  // This catches models downloaded via the HuggingFace search flow that are
  // not present in the curated MODELS_TO_DOWNLOAD list.
  if (!modelPath && fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.gguf')) continue;
        if (isMmprojFile(f)) continue;
        const fp = path.join(modelsDir, f);
        const stats = fs.statSync(fp);
        if (stats.size > 1024 * 1024) {
          modelPath = fp;
          console.log(`Using model via directory scan: ${f}`);
          // Persist so vision/mmproj detection works downstream
          store.set('activeModelFilename', f);
          // Check if this file has a paired mmproj in MODELS_TO_DOWNLOAD
          const entry = MODELS_TO_DOWNLOAD.find((m) => m.filename === f);
          if (entry && entry.mmprojFilename) {
            store.set('activeModelMmprojFilename', entry.mmprojFilename);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error scanning models directory:', err.message);
    }
  }

  if (!modelPath) {
    const errMsg = 'Model not found. Please download at least one model before starting the server.';
    lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
    console.error(errMsg);
    return false;
  }

  const publicDir = getPublicDirectory();

  console.log('Starting llama-server...');
  console.log('Binary:', llamaServerBinary);
  console.log('Model:', modelPath);
  console.log('Public dir:', publicDir);

  const hw = getCachedHardwareCapabilities();
  console.log('Detected hardware:', formatHardwareSummary(hw));
  if ((hw.cuda || hw.rocm || hw.vulkan) && getBestBackend() !== 'cpu') {
    const binDir = path.dirname(llamaServerBinary);
    const hasCudaDll = fs.existsSync(path.join(binDir, 'ggml-cuda.dll')) || fs.existsSync(path.join(binDir, 'libggml-cuda.so'));
    const hasVulkanDll = fs.existsSync(path.join(binDir, 'ggml-vulkan.dll')) || fs.existsSync(path.join(binDir, 'libggml-vulkan.so'));
    const hasRocmDll = fs.existsSync(path.join(binDir, 'ggml-hip.dll')) || fs.existsSync(path.join(binDir, 'libggml-hip.so'));
    if (hw.cuda && !hasCudaDll) {
      console.warn('WARNING: NVIDIA GPU detected but ggml-cuda backend DLL is missing. Server will fall back to CPU inference.');
    }
    if (hw.rocm && !hasRocmDll) {
      console.warn('WARNING: AMD GPU detected but ggml-hip/ROCm backend DLL is missing. Server will fall back to CPU inference.');
    }
    if (hw.vulkan && !hasCudaDll && !hasRocmDll && !hasVulkanDll) {
      console.warn('WARNING: GPU detected but no matching backend DLL (CUDA/HIP/Vulkan) was bundled. Server will fall back to CPU inference.');
    }
  }

  const args = [
    '-m', modelPath,
    ...apiServer.getServerArgs(),
  ];

  // Apply bonsai model presets (flash attention, sampling, reasoning flags).
  // These mirror the Bonsai-demo project's run_llama.sh / start_llama_server.sh
  // defaults. The preset is matched by filename pattern (e.g. "Ternary-Bonsai-27B").
  try {
    const modelFilename = path.basename(modelPath);
    const presetResult = lookupPreset({ filename: modelFilename });
    if (presetResult.overrides) {
      const ov = presetResult.overrides;
      console.log(`[startLlamaServer] Applying preset: ${presetResult.name} (confidence: ${presetResult.confidence})`);

      // Flash attention (-fa on) — always recommended for bonsai models
      if (ov.flashAttn && !args.includes('-fa') && !args.includes('--flash-attn')) {
        args.push('-fa', 'on');
      }

      // GPU layer offload (-ngl)
      // The bonsai presets set nGpuLayers: 99 (full offload). For models
      // without an explicit preset, fall back to 99 when a GPU backend is
      // detected so inference doesn't silently run on CPU.
      if (ov.nGpuLayers !== undefined && !args.includes('-ngl') && !args.includes('--n-gpu-layers')) {
        args.push('-ngl', String(ov.nGpuLayers));
      }

      // Context size (-c 0 = auto-fit to memory)
      if (ov.ctxSize !== undefined && !args.includes('-c')) {
        args.push('-c', String(ov.ctxSize));
      }

      // Parallel slots (-np)
      // Bonsai presets force -np 1 to keep KV cache bounded. Without this,
      // llama-server auto-detects -np 4 which multiplies KV cache by 4 and
      // can spill to system RAM, killing decode performance.
      if (ov.parallel !== undefined && !args.includes('-np')) {
        args.push('-np', String(ov.parallel));
      }

      // KV cache types
      if (ov.typeK && ov.typeK !== 'f16' && !args.includes('--type-k') && !args.includes('--cache-type-k')) {
        args.push('--type-k', ov.typeK);
      }
      if (ov.typeV && ov.typeV !== 'f16' && !args.includes('--type-v') && !args.includes('--cache-type-v')) {
        args.push('--type-v', ov.typeV);
      }

      // Sampling defaults (temp, top-p, top-k, min-p)
      if (ov.sampling) {
        if (ov.sampling.temp !== undefined && !args.includes('--temp')) {
          args.push('--temp', String(ov.sampling.temp));
        }
        if (ov.sampling.topP !== undefined && !args.includes('--top-p')) {
          args.push('--top-p', String(ov.sampling.topP));
        }
        if (ov.sampling.topK !== undefined && !args.includes('--top-k')) {
          args.push('--top-k', String(ov.sampling.topK));
        }
        if (ov.sampling.minP !== undefined && !args.includes('--min-p')) {
          args.push('--min-p', String(ov.sampling.minP));
        }
      }

      // Jinja (native tool calling) — 27B only
      if (ov.jinja && !args.includes('--jinja')) {
        args.push('--jinja');
      }

      // Reasoning budget / format — smaller models disable thinking
      if (ov.reasoningBudget !== undefined && !args.includes('--reasoning-budget')) {
        args.push('--reasoning-budget', String(ov.reasoningBudget));
      }
      if (ov.reasoningFormat && !args.includes('--reasoning-format')) {
        args.push('--reasoning-format', ov.reasoningFormat);
      }

      // ── Experimental features (opt-in via electron-store) ─────────────
      // These are controlled by the user via the Providers settings UI and
      // persisted in electron-store as `bonsaiExperimental`.
      // See Bonsai-demo KV-CACHE.md and SPECULATIVE.md for details.
      const experimental = store.get('bonsaiExperimental', { kv4: false, speculative: false });

      // 4-bit KV cache (BONSAI_KV4=1 equivalent)
      // ~3.5x smaller KV memory; decode slightly slower than F16.
      // Requires flash attention (already enabled above).
      // Auto-detects *-kv-bias*.gguf for mean-centering quality boost.
      if (experimental.kv4 && ov.kv4 !== undefined) {
        if (!args.includes('--cache-type-k') && !args.includes('--type-k')) {
          args.push('--cache-type-k', 'q4_0');
        }
        if (!args.includes('--cache-type-v') && !args.includes('--type-v')) {
          args.push('--cache-type-v', 'q4_0');
        }
        // Look for a kv-bias file in the same directory as the model
        const modelDir = path.dirname(modelPath);
        try {
          const dirFiles = fs.readdirSync(modelDir);
          const biasFile = dirFiles.find(f => /kv[-_]?bias/i.test(f) && f.endsWith('.gguf'));
          if (biasFile && !args.includes('--kv-mean-center')) {
            args.push('--kv-mean-center', path.join(modelDir, biasFile));
            // The bias is calibrated with K-rotation off; inference must match.
            process.env.LLAMA_ATTN_ROT_DISABLE = '1';
            console.log(`[startLlamaServer] KV cache: q4_0 + mean-centering (${biasFile})`);
          } else {
            console.log('[startLlamaServer] KV cache: q4_0 (no bias file found; run make_kv_bias.sh for better quality)');
          }
        } catch (_) { /* ignore */ }
      }

      // Speculative decoding with dspark drafter (BONSAI_SPECULATIVE=1 equivalent)
      // ~1.8-2x faster decode on CUDA for code/reasoning. CUDA only.
      // Trade-offs: disables cross-request prompt-cache reuse, forces single slot.
      if (experimental.speculative && ov.speculative && ov.speculative.enabled !== undefined) {
        const spec = ov.speculative;
        // Find the dspark drafter GGUF in the same directory
        const modelDir = path.dirname(modelPath);
        try {
          const dirFiles = fs.readdirSync(modelDir);
          const drafterFile = dirFiles.find(f => /dspark[-_]Q4_1/i.test(f) && f.endsWith('.gguf'));
          if (drafterFile) {
            const drafterPath = path.join(modelDir, drafterFile);
            if (!args.includes('-md')) {
              args.push('-md', drafterPath);
            }
            if (!args.includes('--spec-type')) {
              args.push('--spec-type', spec.mode || 'draft-dspark');
            }
            if (!args.includes('--spec-draft-n-max')) {
              args.push('--spec-draft-n-max', String(spec.nMax || 4));
            }
            if (!args.includes('-ngld')) {
              args.push('-ngld', String(spec.ngld || 999));
            }
            // Speculative forces single slot
            if (!args.includes('-np')) {
              args.push('-np', String(spec.parallel || 1));
            } else {
              // Replace existing -np value with 1
              const npIdx = args.indexOf('-np');
              if (npIdx >= 0 && npIdx + 1 < args.length) {
                args[npIdx + 1] = String(spec.parallel || 1);
              }
            }
            // Increase context for speculation (re-prefills each request)
            if (spec.ctxSize && spec.ctxSize > 0) {
              const cIdx = args.indexOf('-c');
              if (cIdx >= 0 && cIdx + 1 < args.length) {
                args[cIdx + 1] = String(spec.ctxSize);
              } else {
                args.push('-c', String(spec.ctxSize));
              }
            }
            console.log(`[startLlamaServer] Speculative decoding: ${drafterFile} (draft-dspark, n-max ${spec.nMax || 4})`);
          } else {
            console.warn('[startLlamaServer] Speculative decoding enabled but no *dspark-Q4_1*.gguf drafter found in', modelDir, '— running without speculation.');
          }
        } catch (_) { /* ignore */ }
      }
    }
  } catch (presetErr) {
    console.warn('[startLlamaServer] Preset lookup failed:', presetErr.message);
  }

  // ── GPU offload fallback ───────────────────────────────────────────────
  // If no preset applied -ngl (e.g. a non-bonsai model with no matching
  // preset), detect the best available backend and default to full offload
  // (-ngl 99). Without this, llama-server defaults to -ngl 0 (CPU-only),
  // which gives ~8 tok/s on a 27B model instead of 30-60+ tok/s on GPU.
  if (!args.includes('-ngl') && !args.includes('--n-gpu-layers')) {
    const backend = getBestBackend();
    if (backend !== 'cpu') {
      args.push('-ngl', '99');
      console.log(`[startLlamaServer] GPU backend (${backend}) detected — applying -ngl 99 (full offload)`);
    } else {
      console.log('[startLlamaServer] No GPU backend detected — running on CPU (no -ngl)');
    }
  }

  // ── Thread count fallback ──────────────────────────────────────────────
  // Ensure -t is set so llama-server uses all physical cores rather than
  // its conservative default. On the Ryzen AI 9 HX 370 (12 physical cores),
  // this ensures CPU-side operations (tokenizer, sampling, partial layers)
  // use the full CPU.
  if (!args.includes('-t') && !args.includes('--threads')) {
    try {
      const { detectPhysicalCores } = require('./advanced-args');
      const cores = detectPhysicalCores();
      if (cores > 0) {
        args.push('-t', String(cores));
        console.log(`[startLlamaServer] Threads: -t ${cores} (physical cores)`);
      }
    } catch (_) { /* detectPhysicalCores not available — let llama-server default */ }
  }

  // Check for mmproj (vision/multimodal projector) file matched to the active model
  let mmprojPath = null;

  // 1. Check Vision_Pairing_Manager for stored pairings
  if (global.visionPairingManager && activeModelFilename) {
    try {
      const pairing = await global.visionPairingManager.getModelPair(activeModelFilename);
      if (pairing) {
        const pairedMmprojPath = path.join(modelsDir, pairing.mmproj);
        if (fs.existsSync(pairedMmprojPath)) {
          mmprojPath = pairedMmprojPath;
          console.log('[startLlamaServer] Using vision pairing from manager:', mmprojPath);
          
          // Check if offload flag is set
          if (pairing.offload) {
            args.push('--mmproj-offload');
            console.log('[startLlamaServer] mmproj offload enabled');
          }
        }
      }
    } catch (err) {
      console.warn('[startLlamaServer] Vision pairing lookup failed:', err.message);
      // Fall through to legacy detection
    }
  }

  // 2. Prefer the mmproj explicitly paired with this model in MODELS_TO_DOWNLOAD
  if (!mmprojPath) {
    const activeModelEntry = MODELS_TO_DOWNLOAD.find((m) => m.filename === activeModelFilename);
    if (activeModelEntry && activeModelEntry.mmprojFilename) {
      const pairedMmprojPath = path.join(modelsDir, activeModelEntry.mmprojFilename);
      if (fs.existsSync(pairedMmprojPath)) {
        mmprojPath = pairedMmprojPath;
        console.log('Using paired mmproj for active model:', mmprojPath);
      }
    }
  }

  // 3. Check store for a previously-set mmproj (e.g. from HF download)
  if (!mmprojPath) {
    const storedMmprojFilename = store.get('activeModelMmprojFilename', null);
    if (storedMmprojFilename) {
      const storedMmprojPath = path.join(modelsDir, storedMmprojFilename);
      if (fs.existsSync(storedMmprojPath)) {
        mmprojPath = storedMmprojPath;
        console.log('Using stored mmproj for active model:', mmprojPath);
      }
    }
  }

  // 4. Fall back: scan directory and try to match by model base name.
  //    Matches both "mmproj-*.gguf" (convention) and "*-mmproj-*.gguf"
  //    (Bonsai convention: Ternary-Bonsai-27B-mmproj-Q8_0.gguf).
  if (!mmprojPath) {
    const modelBaseName = path.basename(modelPath, '.gguf');
    const allMmprojFiles = fs.readdirSync(modelsDir)
      .filter((f) => f.toLowerCase().endsWith('.gguf') && isMmprojFile(f));
    // Look for an mmproj whose filename contains the model base name
    const matchedMmproj = allMmprojFiles.find((f) =>
      f.toLowerCase().includes(modelBaseName.toLowerCase())
    );
    if (matchedMmproj) {
      mmprojPath = path.join(modelsDir, matchedMmproj);
      console.log('Using matched mmproj for active model:', mmprojPath);
    }
    // Removed dangerous fallback: do NOT use arbitrary mmproj files for unrelated models
  }

  if (mmprojPath) {
    args.push('--mmproj', mmprojPath);
  }

  // Only add --path if public directory exists
  if (fs.existsSync(publicDir)) {
    args.push('--path', publicDir);
    console.log('Serving webui from:', publicDir);
  }

  // Verify Microsoft Visual C++ runtime is present (Windows only).
  // llama-server.exe and its DLLs are MSVC-built and cannot start without it.
  const vcCheck = binaryManager.verifyVcRuntime();
  if (!vcCheck.ok) {
    console.warn(`[startLlamaServer] VC++ runtime missing: ${vcCheck.missing.join(', ')}`);
    // Try to install the bundled redistributable (portable builds or failed installs)
    const vcRedistPath = path.join(process.resourcesPath, '..', 'vc_redist.x64.exe');
    if (fs.existsSync(vcRedistPath)) {
      console.log(`[startLlamaServer] Attempting to install bundled VC++ redistributable: ${vcRedistPath}`);
      try {
        execSync(`"${vcRedistPath}" /install /quiet /norestart`, { timeout: 60000, windowsHide: true });
        const vcCheckAfter = binaryManager.verifyVcRuntime();
        if (!vcCheckAfter.ok) {
          const errMsg = `VC++ Redistributable installation attempted but ${vcCheckAfter.missing.join(', ')} are still missing. Please install the latest VC++ Redistributable from Microsoft manually.`;
          lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
          console.error(errMsg);
          return false;
        }
        console.log('[startLlamaServer] VC++ redistributable installed successfully.');
      } catch (installErr) {
        const errMsg = `VC++ Redistributable is missing (${vcCheck.missing.join(', ')}) and bundled installer failed: ${installErr.message}. Please install the latest VC++ Redistributable from Microsoft manually.`;
        lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
        console.error(errMsg);
        return false;
      }
    } else {
      const errMsg = `VC++ Redistributable is missing (${vcCheck.missing.join(', ')}). Please install the latest VC++ Redistributable from Microsoft (https://aka.ms/vs/17/release/vc_redist.x64.exe).`;
      lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
      console.error(errMsg);
      return false;
    }
  }

  // Prepend bin directory to PATH so sibling DLLs (ggml.dll, llama.dll, etc.)
  // are always resolvable even if the inherited PATH differs between environments.
  // Windows DLL loader also searches the EXE's own directory, so this is an
  // additional safety net.
  const binDir = path.dirname(llamaServerBinary);
  const spawnEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  // Log the full argv so perf regressions (missing -ngl, wrong -t, -c, -np)
  // are visible in the service log without having to reproduce the spawn.
  console.log('[startLlamaServer] Final argv:', JSON.stringify(args));

  const spawnedProcess = spawn(llamaServerBinary, args, { env: spawnEnv });
  llamaServerProcess = spawnedProcess;

  // Collect stderr for diagnostics in case of crash
  const stderrBuffer = [];

  spawnedProcess.stdout.on('data', (data) => {
    appendLog('llama-server', data);
  });

  spawnedProcess.stderr.on('data', (data) => {
    stderrBuffer.push(data.toString());
    appendLog('llama-server', data);
  });

  spawnedProcess.on('close', (code) => {
    console.log(`llama-server process exited with code ${code}`);
    // Only null out if this is still the current process (prevents race during model switch)
    if (llamaServerProcess === spawnedProcess) {
      llamaServerProcess = null;
      isServerRunning = false;
    }
  });

  // Wait up to 3 s for an immediate crash.  A crash from a missing VC++ runtime
  // or an illegal CPU instruction always produces a non-zero exit code (e.g.
  // 0xC000007B / 0xC0000135 on Windows).  Only flag a non-zero exit as a crash
  // so that a normal code-0 exit in any unusual edge case doesn't cause a false
  // positive and an unnecessary 120-second wait is avoided.
  const crashedEarly = await new Promise((resolve) => {
    let settled = false;
    const guardTimer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, 3000);
    spawnedProcess.once('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(guardTimer);
        if (code !== 0 && code !== null) {
          console.error(`[startLlamaServer] Process exited early with code ${code} — binary crash or missing dependency`);
          resolve(true);
        } else {
          // Code 0 within 3 s is unexpected but not a DLL/CPU crash; don't block.
          console.warn(`[startLlamaServer] Process exited with code ${code} within 3 s`);
          resolve(false);
        }
      }
    });
  });

  if (crashedEarly) {
    llamaServerProcess = null;
    isServerRunning = false;
    // Diagnose the exact cause from the exit code we observed
    const exitCode = spawnedProcess.exitCode;
    const stderrTail = stderrBuffer.slice(-5).join('').trim();

    // If GPU backend crashed and we haven't tried CPU fallback yet, retry with CPU
    const backendName = binaryManager.mapCapabilitiesToBackend(getCachedHardwareCapabilities());
    const isGpuBackend = !backendName.includes('cpu') && !forceCpuBackend;
    if (isGpuBackend) {
      console.warn(`[startLlamaServer] GPU backend (${backendName}) crashed with exit code ${exitCode}. Retrying with CPU backend...`);
      if (stderrTail) console.warn(`[startLlamaServer] stderr: ${stderrTail}`);
      return startLlamaServer(true);
    }

    let diagnosis = '';
    if (exitCode === 0xC0000135 || exitCode === 3221225781) {
      diagnosis = 'A required DLL (likely VC++ runtime vcruntime140.dll / msvcp140.dll) was not found on this system.';
    } else if (exitCode === 0xC000007B || exitCode === 3221225595) {
      diagnosis = 'The binary is incompatible with this system (wrong architecture or missing dependency DLL). Check that the bundled backend matches your CPU/GPU.';
    } else if (exitCode === 0xC000001D || exitCode === 3221225501) {
      diagnosis = 'The binary uses CPU instructions (e.g. AVX-512) not supported by this processor. Try downloading a CPU backend without AVX-512 from Settings > Backend.';
    } else {
      diagnosis = `llama-server crashed immediately (exit code ${exitCode}).`;
      if (stderrTail) {
        diagnosis += ` Error details: ${stderrTail}`;
      } else {
        diagnosis += ' See services.log for details.';
      }
    }
    const errMsg = diagnosis;
    lastMainError = { source: 'startLlamaServer', message: errMsg, time: new Date().toISOString() };
    console.error(errMsg);
    return false;
  }

  // Verify the server actually bound to the port.  llama-server loads the
  // model before starting the HTTP listener, so on slow drives this can
  // take 30–90 s.  We give it up to 90 s — if it never binds, the process
  // is likely stuck or the port is held by a zombie.
  const modelLoadStartTime = Date.now();
  let stopProgressWatcher = null;
  try {
    console.log(`[startLlamaServer] Waiting up to 90s for server to bind on port ${serverPort}...`);
    stopProgressWatcher = startModelLoadProgressWatcher(stderrBuffer, modelLoadStartTime);
    await waitForPortInUse(serverPort, 90000);
    if (stopProgressWatcher) stopProgressWatcher();
    console.log(`[startLlamaServer] Server confirmed listening on port ${serverPort}.`);
    isServerRunning = true;

    // Register with scheduler for lifecycle management
    if (scheduler && modelPath) {
      try {
        scheduler.setSpawnContext({
          llamaServerBinary,
          mmprojPath,
          extraArgv: ['--path', publicDir].filter(Boolean),
        });
        const runner = await scheduler.registerExternalRunner(modelPath, llamaServerProcess, serverPort, {
          purpose: 'primary',
        });
        console.log('[startLlamaServer] Registered with scheduler: ' + runner.modelPath + ' on port ' + runner.port);
      } catch (regErr) {
        console.warn('[startLlamaServer] Scheduler registration failed:', regErr.message);
        // Non-critical: server is already running; scheduler tracking is a bonus
      }
    }

    // Register with SlotManager so the API Gateway (port 13439) can route to this server.
    // The gateway's selectSlot() only returns slots with status === 'running', so without
    // this registration, /v1/chat/completions on port 13439 returns 503 no_model_slot_available.
    if (global.slotManager && llamaServerProcess && modelPath) {
      try {
        const slot = global.slotManager.getSlotByPort(serverPort);
        if (slot && slot.status !== 'running') {
          await global.slotManager.registerExternalRunner(slot.id, {
            process: llamaServerProcess,
            modelPath,
            mmprojPath: mmprojPath || null,
            purpose: 'primary',
          });
          console.log(`[startLlamaServer] Registered with SlotManager: slot ${slot.id} (port ${serverPort}) now running`);
        }
      } catch (slotErr) {
        console.warn('[startLlamaServer] SlotManager registration failed:', slotErr.message);
        // Non-critical: the legacy server on serverPort still works directly; only gateway routing is affected
      }
    }

    return true;
  } catch (portErr) {
    if (stopProgressWatcher) stopProgressWatcher();
    console.error(`[startLlamaServer] Server never bound to port ${serverPort}:`, portErr.message);
    const stderrTail = stderrBuffer.slice(-10).join('').trim();
    if (stderrTail) {
      console.error('[startLlamaServer] stderr tail:', stderrTail);
    }
    try { spawnedProcess.kill(); } catch (_) { /* ignore */ }
    killProcessOnPort(serverPort);
    llamaServerProcess = null;
    isServerRunning = false;
    let errMessage = `llama-server started but never bound to port ${serverPort}. It may be stuck loading the model, or another process is holding the port.`;
    if (stderrTail) {
      errMessage += ' Server output: ' + stderrTail.substring(0, 500);
    }
    lastMainError = {
      source: 'startLlamaServer',
      message: errMessage,
      time: new Date().toISOString()
    };
    return false;
  }
}

/**
 * Kill any process listening on the given port, and all llama-server instances.
 * Uses non-blocking exec so the main thread never stalls during shutdown.
 */
function killProcessOnPort(port) {
  if (process.platform === 'win32') {
    const { exec } = require('child_process');

    // Non-blocking: kill by image name first (fastest, catches all instances)
    exec('taskkill /F /IM llama-server.exe', { windowsHide: true }, () => {});

    // Also try port-based kill (belt-and-suspenders)
    exec('netstat -ano', { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;
      const lines = stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('TCP')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
        const localAddr = parts[1];
        const portMatch = localAddr.match(/:(\d+)$/);
        if (!portMatch || parseInt(portMatch[1]) !== port) continue;
        const pid = parts[parts.length - 1];
        if (!pid || isNaN(parseInt(pid))) continue;
        exec(`taskkill /F /T /PID ${pid}`, { windowsHide: true }, () => {});
      }
    });
    return;
  }

  // macOS / Linux: non-blocking kill
  const { exec } = require('child_process');
  exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { shell: true }, () => {});
  exec('pkill -9 -f llama-server', () => {});
}

/**
 * Stop the llama-server process as fast as possible.
 * Does not wait for graceful shutdown — we force-kill immediately to prevent
 * the Electron main process from hanging on Windows GPU cleanup.
 * Resolves within 3 s regardless of whether the process actually exited.
 */
async function stopLlamaServer(timeoutMs = 3000) {
  return new Promise((resolve) => {
    // Hard cap — never wait longer than 3 s
    const hardTimeout = setTimeout(() => {
      llamaServerProcess = null;
      isServerRunning = false;
      killProcessOnPort(13434);
      resolve();
    }, Math.min(timeoutMs, 3000));

    // Ask scheduler to terminate the tracked runner first
    if (scheduler) {
      const activeModelFilename = store.get('activeModelFilename', null);
      if (activeModelFilename) {
        const modelsDir = getModelsDirectory();
        const modelPath = path.join(modelsDir, activeModelFilename);
        scheduler.terminateRunner(modelPath).catch(() => {});
      }
    }

    if (!llamaServerProcess) {
      clearTimeout(hardTimeout);
      killProcessOnPort(13434);
      isServerRunning = false;
      resolve();
      return;
    }

    const processToKill = llamaServerProcess;
    const pid = processToKill.pid;

    // If already exited, clean up and go
    if (processToKill.exitCode !== null || processToKill.killed) {
      clearTimeout(hardTimeout);
      llamaServerProcess = null;
      isServerRunning = false;
      killProcessOnPort(13434);
      resolve();
      return;
    }

    // Listen for the process exit so we can resolve early
    processToKill.once('close', () => {
      clearTimeout(hardTimeout);
      llamaServerProcess = null;
      isServerRunning = false;
      killProcessOnPort(13434);
      resolve();
    });

    // Fire force-kill immediately (non-blocking)
    if (process.platform === 'win32') {
      try {
        // /F /T = force kill + entire process tree; /IM = by image name is safer than PID
        const { exec } = require('child_process');
        exec(`taskkill /F /T /IM llama-server.exe`, { windowsHide: true }, (err) => {
          if (err) {
            // Fallback: try by PID if image-name kill failed
            try { processToKill.kill(); } catch (_) {}
          }
        });
        // Also try PID-specific kill as belt-and-suspenders
        try { processToKill.kill(); } catch (_) {}
      } catch (e) {
        console.error('[stopLlamaServer] Error force-killing:', e.message);
      }
    } else {
      try {
        processToKill.kill('SIGKILL');
      } catch (e) {
        console.error('[stopLlamaServer] SIGKILL failed:', e.message);
      }
    }
  });
}

function findLlamaServerBinary() {
  const possiblePaths = [
    // Packaged app with asarUnpack: binary in app.asar.unpacked/bin/
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', 'llama-server.exe'),
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', 'llama-server'),
    // Packaged app: binary next to main.js in bin/
    path.join(__dirname, 'bin', 'llama-server.exe'),
    path.join(__dirname, 'bin', 'llama-server'),
    // Development paths
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release', 'llama-server.exe'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release', 'llama-server'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'llama-server.exe'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'llama-server'),
    path.join(__dirname, 'llama-server.exe'),
    path.join(__dirname, 'llama-server')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback: look in the runtime-downloaded backends directory
  // (userData/backends/<tag>/<backend>/llama-server[.exe]). This lets the
  // app treat a previously auto-downloaded backend as "installed" on
  // subsequent launches so we skip the network round-trip and the setup
  // banner no longer warns about a missing binary.
  try {
    return findDownloadedLlamaServerBinary();
  } catch (err) {
    console.warn('[findLlamaServerBinary] Downloaded backend lookup failed:', err.message);
    return null;
  }
}

/**
 * Search the runtime backends directory (managed by binary-manager) for a
 * usable llama-server binary. Prefers the backend matching the current
 * hardware capabilities, falls back to any backend with the required DLLs,
 * and picks the newest llama.cpp tag when multiple are cached.
 */
function findDownloadedLlamaServerBinary() {
  if (!app || typeof app.getPath !== 'function') return null;
  const backendsDir = binaryManager.getBackendsDir(app);
  if (!fs.existsSync(backendsDir)) return null;

  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const preferredBackend = binaryManager.mapCapabilitiesToBackend(getCachedHardwareCapabilities());

  // Sort tags so the newest release is tried first. llama.cpp tags look like
  // "b1234"; a lexicographic sort on the numeric suffix works reliably.
  const tags = fs.readdirSync(backendsDir)
    .filter((t) => {
      try { return fs.statSync(path.join(backendsDir, t)).isDirectory(); }
      catch (_) { return false; }
    })
    .sort((a, b) => {
      const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
      return nb - na;
    });

  const tryBackend = (tag, backend) => {
    const backendDir = path.join(backendsDir, tag, backend);
    if (!fs.existsSync(backendDir)) return null;
    const direct = path.join(backendDir, exeName);
    const exe = fs.existsSync(direct) ? direct : null;
    if (!exe) return null;
    const dirForDlls = path.dirname(exe);
    const dllCheck = binaryManager.verifyBackendDlls(dirForDlls, backend);
    if (!dllCheck.ok) return null;
    return exe;
  };

  // First pass: preferred backend for current hardware across all cached tags.
  for (const tag of tags) {
    const found = tryBackend(tag, preferredBackend);
    if (found) return found;
  }

  // Second pass: any backend with the required DLLs (supports CPU fallback
  // or a user who switched GPUs since the last install).
  for (const tag of tags) {
    const tagDir = path.join(backendsDir, tag);
    let backends = [];
    try { backends = fs.readdirSync(tagDir); } catch (_) { continue; }
    for (const backend of backends) {
      if (backend === preferredBackend) continue;
      const found = tryBackend(tag, backend);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Return metadata about the currently active llama-server binary.
 * Distinguishes bundled (shipped with the app) from runtime-downloaded
 * backends so the UI can show the correct version and update path.
 */
function getCurrentBackendInfo() {
  const binary = findLlamaServerBinary();
  if (!binary) {
    return { tag: null, backend: null, path: null, isBundled: false, installed: false };
  }

  const backendsDir = binaryManager.getBackendsDir(app);
  const normalized = path.normalize(binary);
  const normalizedBackends = path.normalize(backendsDir);

  if (normalized.startsWith(normalizedBackends)) {
    // Runtime-downloaded backend: path is .../backends/<tag>/<backend>/...
    const relative = path.relative(normalizedBackends, normalized);
    const parts = relative.split(path.sep);
    const tag = parts[0] || null;
    const backend = parts[1] || null;
    return { tag, backend, path: binary, isBundled: false, installed: true };
  }

  // Bundled binary: we can't determine a tag, but we know it's present.
  return { tag: 'bundled', backend: 'bundled', path: binary, isBundled: true, installed: true };
}

function getPublicDirectory() {
  // In packaged app with asarUnpack: files are in app.asar.unpacked
  // Must check this FIRST because external processes (llama-server.exe)
  // cannot read from the asar archive, only from unpacked paths
  const unpackedDir = path.join(__dirname, '..', 'app.asar.unpacked', 'public');
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir;
  }
  // In dev: public is in the same directory as main.js
  const devDir = path.join(__dirname, 'public');
  if (fs.existsSync(devDir)) {
    return devDir;
  }
  // Fallback: relative to executable
  const execDir = path.dirname(process.execPath);
  const resourcesDir = path.join(execDir, 'resources');
  const fallbackPaths = [
    path.join(resourcesDir, 'app.asar.unpacked', 'public'),
    path.join(resourcesDir, 'app', 'public'),
    path.join(resourcesDir, 'public')
  ];
  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return unpackedDir; // Return unpacked path as default even if not found
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', (err) => {
      server.close();
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

function waitForPortFree(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 500;

    const check = async () => {
      const inUse = await isPortInUse(port);
      if (!inUse) {
        console.log(`Port ${port} is free`);
        resolve();
        return;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        reject(new Error(`Port ${port} did not become free within ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, checkInterval);
    };

    check();
  });
}

function waitForPortInUse(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 500;

    const check = async () => {
      const inUse = await isPortInUse(port);
      if (inUse) {
        console.log(`Port ${port} is now in use by server`);
        resolve();
        return;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        reject(new Error(`Port ${port} did not become occupied within ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, checkInterval);
    };

    check();
  });
}

function waitForServerReady(url, timeoutMs = null) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    // Adaptive timeout based on hardware capabilities.
    // Model loading on slow drives can exceed 60 s, so we default to
    // 120 s to avoid false-timeout hangs on relaunch.
    if (!timeoutMs) {
      timeoutMs = 120000; // 120 seconds
    }
    
    const checkInterval = 500; // Check every 500ms instead of 1000ms for faster detection
    const requestTimeoutMs = 5000;

    console.log(`Waiting for server at ${url}... (timeout: ${timeoutMs}ms)`);

    let activeReq = null;
    let checkTimer = null;
    let overallTimer = null;

    function cleanup() {
      if (checkTimer) {
        clearTimeout(checkTimer);
        checkTimer = null;
      }
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      if (activeReq && typeof activeReq.destroy === 'function') {
        activeReq.destroy();
        activeReq = null;
      }
    }

    function onSuccess() {
      cleanup();
      resolve();
    }

    function onFailure(errMessage) {
      cleanup();
      reject(new Error(errMessage));
    }

    overallTimer = setTimeout(() => {
      onFailure(`Server did not start within ${timeoutMs}ms`);
    }, timeoutMs);

    const check = () => {
      if (activeReq && typeof activeReq.destroy === 'function') {
        activeReq.destroy();
        activeReq = null;
      }

      activeReq = http.get(url, (res) => {
        activeReq = null;
        // Any HTTP response means the server is up and listening
        console.log(`Server responded with status: ${res.statusCode}`);
        onSuccess();
      });

      activeReq.setTimeout(requestTimeoutMs, () => {
        if (activeReq && typeof activeReq.destroy === 'function') {
          activeReq.destroy();
        }
        activeReq = null;
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          onFailure(`Server did not start within ${timeoutMs}ms: connection timeout`);
          return;
        }
        console.log(`Server request timed out, retrying... (${elapsed}ms elapsed)`);
        checkTimer = setTimeout(check, checkInterval);
      });

      activeReq.on('error', (err) => {
        activeReq = null;
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          onFailure(`Server did not start within ${timeoutMs}ms: ${err.message}`);
          return;
        }
        console.log(`Server not ready yet, retrying in ${checkInterval}ms... (${elapsed}ms elapsed)`);
        checkTimer = setTimeout(check, checkInterval);
      });
    };

    check();
  });
}

function getModelsDirectory() {
  const modelsDir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

/**
 * Detect whether a GGUF filename is a vision projector (mmproj) file.
 *
 * mmproj files are not standalone chat models — they are loaded alongside a
 * base model to provide vision/image understanding. They must be excluded
 * from chat model lists.
 *
 * Supports two naming conventions:
 * 1. Standard llama.cpp: filename starts with "mmproj-" (e.g. "mmproj-model.gguf")
 * 2. Bonsai convention: filename contains "-mmproj-" (e.g. "Ternary-Bonsai-27B-mmproj-Q8_0.gguf")
 *
 * @param {string} filename - the GGUF filename to check
 * @returns {boolean} true if the file is an mmproj (vision projector) file
 */
function isMmprojFile(filename) {
  const lower = filename.toLowerCase();
  return lower.startsWith('mmproj-') || lower.includes('-mmproj-');
}

function getAppDataDirectory() {
  const appDataDir = app.getPath('userData');
  const subdirs = ['models', 'chats', 'settings', 'logs'];
  for (const subdir of subdirs) {
    const dir = path.join(appDataDir, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return appDataDir;
}

function getServicesLogPath() {
  return path.join(getAppDataDirectory(), 'logs', 'services.log');
}

// Tracks the in-app service log viewer window. Declared here (above
// appendLog) so we never hit the temporal dead zone if a subprocess emits
// output unexpectedly early.
let logsViewerWindow = null;

const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
let _logWriteQueue = [];
let _logWritePending = false;

function _rotateLogIfNeeded(logPath) {
  try {
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > LOG_MAX_SIZE) {
        const backupPath = logPath + '.1';
        try { fs.unlinkSync(backupPath); } catch (_) { /* ignore */ }
        fs.renameSync(logPath, backupPath);
      }
    }
  } catch (_) { /* ignore rotation errors */ }
}

function _flushLogQueue() {
  if (_logWritePending || _logWriteQueue.length === 0) return;
  _logWritePending = true;
  const logPath = getServicesLogPath();
  const batch = _logWriteQueue.splice(0, _logWriteQueue.length).join('');
  _rotateLogIfNeeded(logPath);
  fs.appendFile(logPath, batch, (err) => {
    _logWritePending = false;
    if (err) {
      try { _originalConsoleError.call(console, '[appendLog] Write failed:', err.message); } catch (_) {}
    }
    if (_logWriteQueue.length > 0) {
      _flushLogQueue();
    }
  });
}

function appendLog(source, data) {
  const lines = data.toString().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;
  const now = new Date().toISOString();
  const entries = lines.map((l) => `[${now}] [${source}] ${l}\n`).join('');

  // Queue for async batch write
  _logWriteQueue.push(entries);
  _flushLogQueue();

  // Mirror to console using ORIGINAL console.log to avoid infinite recursion
  _originalConsoleLog.call(console, `[${source}]`, data.toString().trimEnd());

  // Stream into any open in-app service-log viewer windows so they stay live.
  try {
    if (logsViewerWindow && !logsViewerWindow.isDestroyed() && entries.length > 0) {
      logsViewerWindow.webContents.send('logs:append', entries);
    }
  } catch (_) { /* ignore */ }
}

// Redirect all main-process console output to services.log so failures on
// end-user machines are diagnosable even without DevTools.
const _originalConsoleLog = console.log;
const _originalConsoleWarn = console.warn;
const _originalConsoleError = console.error;

function _wrapConsole(method, original, level) {
  return function (...args) {
    try {
      original.apply(console, args);
    } catch (_) { /* ignore */ }
    try {
      const message = args.map((a) => (typeof a === 'string' ? a : (a && a.message ? a.message : JSON.stringify(a)))).join(' ');
      appendLog('main', `[${level}] ${message}`);
    } catch (_) { /* ignore */ }
  };
}

console.log = _wrapConsole('log', _originalConsoleLog, 'LOG');
console.warn = _wrapConsole('warn', _originalConsoleWarn, 'WARN');
console.error = _wrapConsole('error', _originalConsoleError, 'ERROR');

function getChatsDirectory() {
  const chatsDir = path.join(app.getPath('userData'), 'chats');
  if (!fs.existsSync(chatsDir)) {
    fs.mkdirSync(chatsDir, { recursive: true });
  }
  return chatsDir;
}

function openServiceLogsWindow() {
  const logPath = getServicesLogPath();

  // Ensure the file exists so the initial read doesn't fail.
  if (!fs.existsSync(logPath)) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '# Service logs will appear here once a server starts.\n');
    } catch (err) {
      console.error('[openServiceLogsWindow] Could not create log file:', err.message);
    }
  }

  // If a viewer is already open, just focus it. Opening a new window each
  // click would cause memory leaks and duplicated event streams.
  if (logsViewerWindow && !logsViewerWindow.isDestroyed()) {
    if (logsViewerWindow.isMinimized()) logsViewerWindow.restore();
    logsViewerWindow.focus();
    return;
  }

  const viewerHtmlPath = path.join(__dirname, 'logs-viewer.html');
  if (!fs.existsSync(viewerHtmlPath)) {
    console.error(`[openServiceLogsWindow] logs-viewer.html not found at ${viewerHtmlPath}; falling back to opening the log file in the default editor.`);
    shell.openPath(logPath);
    return;
  }

  logsViewerWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    title: 'Service Logs — Alpaca',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'resources', process.platform === 'win32' ? 'alpaca.ico' : 'alpaca.png'),
  });

  logsViewerWindow.loadFile(viewerHtmlPath);

  logsViewerWindow.on('closed', () => {
    logsViewerWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Bundled documentation static server
// ---------------------------------------------------------------------------
// Docusaurus emits assets and links with absolute paths (e.g.
// `/assets/js/main.*.js`, `/docs/getting-started/`). Loading these via
// `file://` breaks both asset resolution and Docusaurus's client-side
// router (which compares `window.location.pathname` against the configured
// baseUrl), causing every page to land on the SPA's 404 view.
//
// To make the bundled site work offline we expose it through a tiny HTTP
// server bound to 127.0.0.1 on an ephemeral port. The server is started on
// demand the first time the user opens the docs and reused for the lifetime
// of the app.

let docsServer = null;
let docsServerUrl = null;
let docsServerStartPromise = null;

function findDocsRoot() {
  const candidates = [
    path.join(__dirname, 'docs'),
    path.join(__dirname, 'docs', 'build'),
    path.join(__dirname, '..', 'docs', 'build'),
    // Packaged: asarUnpack places docs under app.asar.unpacked
    path.join(__dirname, '..', 'app.asar.unpacked', 'docs'),
  ];
  // A Docusaurus export is recognised by any of these sentinel files.
  // The landing page is NOT guaranteed to live at `<root>/index.html`:
  // with `routeBasePath: '/docs'` (our config) there is no root page and
  // the homepage redirects to `/docs/intro/` or similar. Previously we
  // only accepted roots that had a top-level `index.html`, which meant
  // `findDocsRoot` returned null and `openDocumentationWindow` fell back
  // to the external GitHub URL. Accept any of these markers instead.
  const markers = ['index.html', '404.html', 'sitemap.xml'];
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const hasMarker = markers.some((m) => fs.existsSync(path.join(root, m)));
    const hasDocsDir = fs.existsSync(path.join(root, 'docs'));
    if (hasMarker || hasDocsDir) return root;
  }
  return null;
}

/**
 * Finds a good landing page when the caller didn't specify one. Picks the
 * first existing page from a curated list so the Documentation window
 * always opens on real content rather than the Docusaurus 404.
 */
function findDocsLandingPath(docsRoot) {
  const candidates = [
    'index.html',
    'docs/index.html',
    'docs/intro/index.html',
    'docs/getting-started/index.html',
    'docs/getting-started/introduction/index.html',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(docsRoot, c))) {
      // Strip the trailing index.html so the URL stays clean and the
      // Docusaurus router matches its configured route.
      return '/' + c.replace(/\/?index\.html$/i, '/').replace(/^\/+/, '');
    }
  }
  return '/';
}

function getDocsMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    case '.map': return 'application/json; charset=utf-8';
    case '.xml': return 'application/xml; charset=utf-8';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

async function startDocsServer() {
  if (docsServerUrl) return docsServerUrl;
  if (docsServerStartPromise) return docsServerStartPromise;

  const docsRoot = findDocsRoot();
  if (!docsRoot) {
    console.warn('[docs] No bundled documentation found.');
    return null;
  }
  const docsRootResolved = path.resolve(docsRoot);

  docsServerStartPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        // Strip query string and hash; decode %20 etc.
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
        if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
        // If the request targets a directory, append index.html (Docusaurus
        // exports each route as `<route>/index.html`).
        let target = path.join(docsRootResolved, urlPath);
        // Path-traversal guard: ensure we never escape the docs root.
        const normalised = path.resolve(target);
        if (!normalised.startsWith(docsRootResolved)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        target = normalised;

        let stat = null;
        try { stat = fs.statSync(target); } catch (_) { stat = null; }
        if (stat && stat.isDirectory()) {
          target = path.join(target, 'index.html');
          try { stat = fs.statSync(target); } catch (_) { stat = null; }
        }
        if (!stat) {
          // Fall back to <root>/404.html so the user gets the styled
          // Docusaurus 404 page rather than a bare browser error.
          const notFoundPage = path.join(docsRootResolved, '404.html');
          if (fs.existsSync(notFoundPage)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            try {
              const stream = fs.createReadStream(notFoundPage);
              stream.on('error', (err) => {
                console.error('[docs] 404 stream error:', err.message);
                if (!res.headersSent) { res.statusCode = 500; res.end('Server Error'); }
                else { res.destroy(); }
              });
              stream.pipe(res);
            } catch (err) {
              console.error('[docs] Failed to stream 404 page:', err.message);
              res.statusCode = 500;
              res.end('Internal Server Error');
            }
            return;
          }
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        // Refuse to serve files that are unreasonably large (>100 MB) to
        // protect the main process from memory pressure during streaming.
        const MAX_DOCS_FILE_SIZE = 100 * 1024 * 1024;
        if (stat.size > MAX_DOCS_FILE_SIZE) {
          console.warn(`[docs] Refusing to serve oversized file ${target} (${stat.size} bytes)`);
          res.statusCode = 403;
          res.end('File Too Large');
          return;
        }

        res.setHeader('Content-Type', getDocsMimeType(target));
        res.setHeader('Cache-Control', 'no-cache');
        try {
          const stream = fs.createReadStream(target);
          stream.on('error', (err) => {
            console.error('[docs] Read stream error for', target, ':', err.message);
            if (!res.headersSent) { res.statusCode = 500; res.end('Server Error'); }
            else { res.destroy(); }
          });
          res.on('error', (err) => {
            console.error('[docs] Response stream error for', target, ':', err.message);
            stream.destroy();
          });
          stream.pipe(res);
        } catch (err) {
          console.error('[docs] Failed to stream file', target, ':', err.message);
          if (!res.headersSent) { res.statusCode = 500; res.end('Internal Server Error'); }
          else { res.destroy(); }
        }
      } catch (err) {
        console.error('[docs] Request handler error:', err.message);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });

    server.on('error', (err) => {
      console.error('[docs] Server error:', err.message);
      docsServerStartPromise = null;
      reject(err);
    });

    // Bind to loopback on an ephemeral port so we never collide with the
    // user's existing services and the docs are not reachable from outside
    // the machine.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      if (!port) {
        reject(new Error('Failed to obtain docs server port'));
        return;
      }
      docsServer = server;
      docsServerUrl = `http://127.0.0.1:${port}`;
      console.log(`[docs] Static server listening at ${docsServerUrl} (root: ${docsRootResolved})`);
      resolve(docsServerUrl);
    });
  });

  return docsServerStartPromise;
}

/**
 * Opens the bundled documentation viewer window.
 *
 * @param {string} docPath - Optional path to a specific documentation page
 *                           (e.g. `/docs/getting-started`).
 */
async function openDocumentationWindow(docPath = '') {
  let docsUrl = null;
  try {
    const baseUrl = await startDocsServer();
    if (baseUrl) {
      // Normalise the requested sub-path: ensure leading slash, no trailing
      // slash on `.html` paths, and trailing slash on directory routes so
      // Docusaurus's router matches the configured baseUrl.
      let sub = String(docPath || '').trim();
      // When no page is requested, pick a real landing page rather than `/`
      // (which 404s on Docusaurus builds that use `routeBasePath: '/docs'`
      // because there is no page mounted at the root).
      if (!sub) {
        const docsRoot = findDocsRoot();
        sub = docsRoot ? findDocsLandingPath(docsRoot) : '/';
      }
      if (!sub.startsWith('/')) sub = '/' + sub;
      if (!sub.toLowerCase().endsWith('.html') && !sub.endsWith('/')) {
        sub = sub + '/';
      }
      docsUrl = baseUrl + sub;
    }
  } catch (err) {
    console.error('[openDocumentationWindow] Failed to start docs server:', err.message);
  }

  if (!docsUrl) {
    console.warn('[openDocumentationWindow] Falling back to online documentation.');
    docsUrl = 'https://alpaca-bonsai.github.io/docs';
  }
  console.log(`[openDocumentationWindow] Loading: ${docsUrl}`);

  // Create documentation viewer window
  const docWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Alpaca Documentation',
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false,
      allowRunningInsecureContentFromWebFrames: false
    },
    icon: path.join(__dirname, 'resources', 'alpaca.png')
  });

  docWindow.loadURL(docsUrl);

  // Log navigation for debugging
  docWindow.webContents.on('did-finish-load', () => {
    console.log(`[openDocumentationWindow] Loaded documentation: ${docsUrl}`);
  });

  docWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[openDocumentationWindow] Failed to load docs: ${errorDescription}`);
  });

  docWindow.on('closed', () => {
    console.log('[openDocumentationWindow] Documentation window closed');
  });
}

function getSettingsDirectory() {
  const settingsDir = path.join(app.getPath('userData'), 'settings');
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  return settingsDir;
}

function getSelectedModels() {
  const selectedModelsPath = path.join(app.getPath('userData'), 'selectedModels.json');
  const selectedModels = store.get('selectedModels', []);
  if (selectedModels.length > 0) {
    return MODELS_TO_DOWNLOAD.filter(model => selectedModels.includes(model.name));
  }
  // Default to all models if no selection exists
  return MODELS_TO_DOWNLOAD;
}

function setSelectedModels(modelNames) {
  store.set('selectedModels', modelNames);
}

/**
 * Download a single file from a URL to a local path, following redirects.
 * Returns a Promise that resolves to { success: boolean, skipped?: boolean, error?: string }.
 */
/**
 * Download a single file from a URL to a local path, following redirects.
 * Returns a Promise that resolves to { success: boolean, skipped?: boolean, error?: string }.
 *
 * @param {string} url - URL to download
 * @param {string} filePath - Local path to save
 * @param {string} downloadId - Progress tracking ID
 * @param {string} label - Human-readable label
 * @param {number} [expectedSize] - Expected file size in bytes for integrity verification
 */
function downloadSingleFile(url, filePath, downloadId, label, expectedSize) {
  return new Promise((resolve) => {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (expectedSize && stats.size !== expectedSize) {
        console.warn(`${label} exists but size mismatch (expected ${expectedSize}, got ${stats.size}). Re-downloading...`);
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
      } else {
        console.log(`${label} already exists (${(stats.size / 1024 / 1024).toFixed(2)} MB), skipping download`);
        resolve({ success: true, skipped: true });
        return;
      }
    }

    downloadProgress.set(downloadId, { progress: 0, total: 0, current: 0, status: 'downloading' });
    console.log(`Downloading ${label} from ${url}`);

    const file = fs.createWriteStream(filePath);
    const requestOptions = {
      headers: { 'User-Agent': 'alpaca/1.0', 'Accept': '*/*' }
    };

    let downloadError = null;
    let downloadedSize = 0;

    function handleSuccess(stream, totalSize) {
      stream.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize) {
          const progress = downloadedSize / totalSize;
          downloadProgress.set(downloadId, { progress, total: totalSize, current: downloadedSize, status: 'downloading' });
        } else {
          downloadProgress.set(downloadId, { progress: 0, total: 0, current: downloadedSize, status: 'downloading' });
        }
      });

      stream.on('error', (err) => {
        downloadError = err.message;
        file.destroy();
      });

      stream.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          if (downloadError) {
            fail(`Stream error: ${downloadError}`);
            return;
          }
          // Verify file size on disk matches what we expected
          const actualSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
          if (totalSize && actualSize !== totalSize) {
            fail(`Size mismatch: expected ${totalSize} bytes, got ${actualSize}`);
            return;
          }
          downloadProgress.set(downloadId, { progress: 1, total: totalSize, current: actualSize, status: 'completed' });
          console.log(`Downloaded ${label} successfully (${actualSize} bytes)`);
          resolve({ success: true });
        });
      });

      file.on('error', (err) => {
        fail(`Write error: ${err.message}`);
      });
    }

    function fail(message) {
      try { file.destroy(); } catch (_) { /* ignore */ }
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
      downloadProgress.set(downloadId, { status: 'error', error: message });
      console.error(`Error downloading ${label}: ${message}`);
      resolve({ success: false, error: message });
    }

    function fetchWithRedirects(fetchUrl, hops) {
      if (hops > 5) { fail('Too many redirects'); return; }
      https.get(fetchUrl, requestOptions, (response) => {
        const code = response.statusCode;
        if (code === 301 || code === 302 || code === 307 || code === 308) {
          const next = response.headers.location;
          if (!next) { fail(`Redirect ${code} with no Location header`); return; }
          response.resume();
          fetchWithRedirects(next, hops + 1);
          return;
        }
        if (code === 200) {
          const totalSize = parseInt(response.headers['content-length'], 10) || 0;
          handleSuccess(response, totalSize);
          return;
        }
        fail(`HTTP ${code}`);
      }).on('error', (err) => fail(err.message));
    }

    fetchWithRedirects(url, 0);
  });
}

async function downloadModels() {
  const modelsDir = getModelsDirectory();
  const modelsToDownload = getSelectedModels();

  console.log('Starting model downloads...');
  console.log('Models directory:', modelsDir);
  console.log(`Models to download: ${modelsToDownload.length}`);

  const downloadPromises = modelsToDownload.map(async (model) => {
    const modelPath = path.join(modelsDir, model.filename);
    const modelDownloadId = `builtin/${model.filename}`;

    // Download the main model file
    const modelResult = await downloadSingleFile(model.url, modelPath, modelDownloadId, model.name);
    if (!modelResult.success && !modelResult.skipped) {
      const errMsg = `Error downloading ${model.name}: ${modelResult.error}`;
      lastMainError = { source: 'downloadModels', message: errMsg, time: new Date().toISOString() };
      notifyDownloadComplete(model.filename, false, modelResult.error);
      return { success: false, error: modelResult.error, filename: model.filename };
    }

    // Download mmproj (vision projector) if specified — best-effort, do not fail the model
    if (model.mmprojUrl && model.mmprojFilename) {
      const mmprojPath = path.join(modelsDir, model.mmprojFilename);
      const mmprojDownloadId = `builtin/${model.mmprojFilename}`;
      const mmprojResult = await downloadSingleFile(model.mmprojUrl, mmprojPath, mmprojDownloadId, `${model.name} (vision projector)`);
      if (!mmprojResult.success && !mmprojResult.skipped) {
        console.warn(`Mmproj download failed for ${model.name}: ${mmprojResult.error}. Model will work without vision support.`);
      }
    }

    if (modelResult.skipped) {
      return { success: true, skipped: true, filename: model.filename };
    }
    notifyDownloadComplete(model.filename, true);
    return { success: true, filename: model.filename };
  });

  console.log('Model download initiated. Check console for progress.');
  return Promise.all(downloadPromises);
}

// Download progress tracking for HuggingFace downloads and backend downloads
const downloadProgress = new Map();

let backendPreloadPromise = null;

/**
 * Pre-download the correct llama.cpp backend in the background so that
 * by the time the user finishes downloading a model the backend is already
 * cached locally. This prevents the apparent "hang" where the app sits
 * idle for 30-60 s while the backend downloads after model selection.
 */
async function preloadBackend() {
  if (backendPreloadPromise) return backendPreloadPromise;

  const bundled = findLlamaServerBinary();
  if (bundled) {
    console.log('[preloadBackend] Bundled llama-server found, skipping preload.');
    backendPreloadPromise = Promise.resolve({ exePath: bundled, fresh: false });
    return backendPreloadPromise;
  }

  backendPreloadPromise = (async () => {
    try {
      const caps = getCachedHardwareCapabilities();
      const backendName = binaryManager.mapCapabilitiesToBackend(caps);
      const backendDownloadId = `__backend__/${backendName}`;

      downloadProgress.set(backendDownloadId, {
        status: 'downloading',
        progress: 0,
        total: 0,
        current: 0,
      });

      const result = await binaryManager.ensureBackend(
        app,
        caps,
        (current, total) => {
          downloadProgress.set(backendDownloadId, {
            status: 'downloading',
            progress: total ? current / total : 0,
            total,
            current,
          });
        },
        (status) => {
          if (status.phase === 'downloading') {
            downloadProgress.set(backendDownloadId, { status: 'downloading', progress: 0, total: 0, current: 0 });
          } else if (status.phase === 'extracting') {
            downloadProgress.set(backendDownloadId, { status: 'extracting', progress: 0, total: 0, current: 0 });
          } else if (status.phase === 'ready') {
            downloadProgress.set(backendDownloadId, { status: 'completed', progress: 1, total: 1, current: 1 });
          } else if (status.phase === 'error') {
            downloadProgress.set(backendDownloadId, { status: 'error', error: status.error });
          }
        }
      );

      downloadProgress.set(backendDownloadId, { status: 'completed', progress: 1, total: 1, current: 1 });
      console.log('[preloadBackend] Backend ready:', result.exePath);
      return result;
    } catch (err) {
      console.error('[preloadBackend] Backend preload failed:', err.message);
      return null;
    }
  })();

  return backendPreloadPromise;
}

async function searchHuggingFaceRepo(repoId, hfToken) {
  // Use HF_Model_Service if available, otherwise fall back to legacy implementation
  if (global.hfModelService) {
    try {
      console.log(`[searchHuggingFaceRepo] Using HF_Model_Service for repo: ${repoId}`);
      
      // Set token if provided
      if (hfToken) {
        global.hfModelService.setToken(hfToken);
      }

      // Fetch metadata from HuggingFace API
      const repoData = await global.hfModelService.fetchRepoMetadata(repoId);
      
      // Parse siblings into categories
      const siblings = repoData.siblings || [];
      const parsed = global.hfModelService.parseRepoSiblings(siblings);
      
      // Detect vision pairings
      const visionPairings = global.hfModelService.detectVisionPairing(siblings);
      
      // Build response with all file categories
      const _formatFile = (file) => {
        const size = file.size || file.lfs?.size || 0;
        return {
          filename: file.rfilename || file.filename || '',
          size: size,
          sizeFormatted: formatFileSize(size),
          url: `https://huggingface.co/${repoId}/resolve/main/${file.rfilename || file.filename || ''}`,
        };
      };
      const response = {
        repoId: repoData.id || repoId,
        author: repoData.author,
        modelId: repoData.modelId,
        tags: repoData.tags || [],
        downloads: repoData.downloads || 0,
        modelFiles: parsed.regularGguf.map(_formatFile),
        mmprojFiles: parsed.mmproj.map(_formatFile),
        ggufFiles: parsed.regularGguf.map(_formatFile), // backward compatibility
        safetensorsFiles: parsed.safetensors.map(_formatFile),
        hasVisionSupport: parsed.mmproj.length > 0,
        visionPairings: visionPairings,
        readme: `https://huggingface.co/${repoId}/resolve/main/README.md`,
      };

      console.log(`[searchHuggingFaceRepo] Found ${parsed.regularGguf.length} models, ${parsed.mmproj.length} mmproj files`);
      return response;
    } catch (err) {
      console.error(`[searchHuggingFaceRepo] HF_Model_Service error: ${err.message}`);
      // Fall through to legacy implementation
    }
  }

  // Legacy implementation (fallback)
  return new Promise((resolve) => {
    // Clean the repo ID to handle various input formats
    const cleanRepoId = repoId
      .replace(/^https?:\/\/huggingface\.co\//, '')
      .replace(/^huggingface\.co\//, '')
      .replace(/\/$/, '')
      .trim();

    if (!cleanRepoId || !cleanRepoId.includes('/')) {
      resolve({ error: 'Invalid repository ID. Format: author/model-name' });
      return;
    }

    const apiUrl = `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`;
    const urlObj = new URL(apiUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'alpaca/1.0'
      }
    };

    if (hfToken) {
      options.headers.Authorization = `Bearer ${hfToken}`;
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve({ error: 'Repository not found' });
          return;
        }
        if (res.statusCode === 401) {
          resolve({ error: 'Unauthorized. The repository may require a HuggingFace token, or the token provided is invalid.' });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ error: `Failed to fetch repository: HTTP ${res.statusCode}` });
          return;
        }

        try {
          const repoData = JSON.parse(data);
          const siblings = repoData.siblings || [];
          const allGgufFiles = siblings
            .filter((file) => file.rfilename.toLowerCase().endsWith('.gguf'))
            .map((file) => {
              const size = file.size || file.lfs?.size || 0;
              return {
                filename: file.rfilename,
                size: size,
                sizeFormatted: formatFileSize(size),
                url: `https://huggingface.co/${cleanRepoId}/resolve/main/${file.rfilename}`,
              };
            });

          const mmprojFiles = allGgufFiles.filter((file) =>
            isMmprojFile(file.filename)
          );
          const modelFiles = allGgufFiles.filter(
            (file) => !isMmprojFile(file.filename)
          );

          const tags = repoData.tags || [];
          const visionTags = ['vision', 'multimodal', 'image', 'llava', 'bakllava', 'moondream', 'bunny'];
          const hasVisionSupport = visionTags.some((t) =>
            tags.some((tag) => tag.toLowerCase().includes(t))
          ) || mmprojFiles.length > 0;

          resolve({
            repoId: cleanRepoId,
            author: repoData.author,
            modelId: repoData.modelId,
            tags: tags,
            downloads: repoData.downloads || 0,
            modelFiles: modelFiles,
            mmprojFiles: mmprojFiles,
            ggufFiles: modelFiles, // keep for backward compatibility
            hasVisionSupport: hasVisionSupport,
            readme: `https://huggingface.co/${cleanRepoId}/resolve/main/README.md`,
          });
        } catch (parseErr) {
          resolve({ error: 'Failed to parse repository response' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ error: `Network error: ${err.message}` });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ error: 'Request timed out' });
    });

    req.end();
  });
}

function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function getInstalledModels() {
  const modelsDir = getModelsDirectory();
  if (!fs.existsSync(modelsDir)) return [];

  const files = fs.readdirSync(modelsDir);
  const allGgufFiles = files.filter((f) => f.toLowerCase().endsWith('.gguf'));
  const mmprojFiles = allGgufFiles.filter((f) => isMmprojFile(f));

  return allGgufFiles
    .filter((f) => !isMmprojFile(f))
    .map((f) => {
      const filePath = path.join(modelsDir, f);
      const stats = fs.statSync(filePath);
      const baseName = f.replace(/\.gguf$/i, '');

      // Find mmproj files specifically associated with this model
      const pairedMmprojFiles = mmprojFiles.filter((m) => {
        const mLower = m.toLowerCase();
        const fLower = f.toLowerCase();
        // Check if mmproj filename contains the model base name
        if (mLower.includes(baseName.toLowerCase())) return true;
        // Check if there's a built-in model entry pairing
        const builtinEntry = MODELS_TO_DOWNLOAD.find((entry) => entry.filename === f && entry.mmprojFilename === m);
        if (builtinEntry) return true;
        return false;
      });

      // Check if this model has a vision pairing
      let visionPairing = null;
      if (global.visionPairingManager) {
        try {
          // Note: This is synchronous but visionPairingManager uses async methods
          // For now, we'll just note that pairing info is available via API
          visionPairing = null; // Will be fetched via IPC in UI
        } catch (err) {
          console.warn(`[getInstalledModels] Failed to get vision pairing for ${f}:`, err.message);
        }
      }

      return {
        filename: f,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        modified: stats.mtime.toISOString(),
        path: filePath,
        hasMmproj: pairedMmprojFiles.length > 0,
        mmprojFiles: pairedMmprojFiles,
        visionPairing: visionPairing,
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

async function downloadHuggingFaceModel(repoId, filename, hfToken) {
  // Use HF_Model_Service if available, otherwise fall back to legacy implementation
  if (global.hfModelService && global.visionPairingManager) {
    return new Promise(async (resolve, reject) => {
      try {
        const modelsDir = getModelsDirectory();
        const cleanRepoId = repoId
          .replace(/^https?:\/\/huggingface\.co\//, '')
          .replace(/\/$/, '')
          .trim();
        const modelPath = path.join(modelsDir, filename);
        const downloadId = `${cleanRepoId}/${filename}`;

        // Check if file already exists
        if (fs.existsSync(modelPath)) {
          const stats = fs.statSync(modelPath);
          if (stats.size > 1024 * 1024) {
            console.log(`[downloadHuggingFaceModel] File already exists: ${filename}`);
            resolve({ success: true, skipped: true, filename });
            return;
          }
        }

        console.log(`[downloadHuggingFaceModel] Starting download using HF_Model_Service: ${filename}`);
        
        // Set token if provided
        if (hfToken) {
          global.hfModelService.setToken(hfToken);
        }

        // Initialize download progress tracking
        downloadProgress.set(downloadId, { progress: 0, total: 0, current: 0, status: 'downloading' });

        // Fetch repo metadata to get SHA-256 hash
        const repoData = await global.hfModelService.fetchRepoMetadata(cleanRepoId);
        const siblings = repoData.siblings || [];
        const fileMetadata = siblings.find(f => f.rfilename === filename);
        
        if (!fileMetadata) {
          throw new Error(`File not found in repository: ${filename}`);
        }

        const expectedHash = fileMetadata.lfs?.sha256 || fileMetadata.sha256;
        const totalSize = fileMetadata.lfs?.size || fileMetadata.size || 0;

        // Set up progress handler
        const onProgress = (bytesDownloaded, totalBytes, percentComplete) => {
          downloadProgress.set(downloadId, {
            progress: percentComplete,
            total: totalBytes,
            current: bytesDownloaded,
            status: 'downloading',
          });
        };

        // Download with resume support
        const downloadResult = await global.hfModelService.downloadWithResume(
          cleanRepoId,
          filename,
          modelPath,
          { sha256: expectedHash, size: totalSize, onProgress }
        );

        // Detect and store vision pairings if this is a base model
        if (!isMmprojFile(filename)) {
          try {
            const pairings = global.hfModelService.detectVisionPairing(siblings);
            const basePairing = pairings.find(p => p.base === filename);
            
            if (basePairing && global.visionPairingManager) {
              console.log(`[downloadHuggingFaceModel] Detected vision pairing for ${filename}: ${basePairing.mmproj}`);
              await global.visionPairingManager.storeModelPair(
                basePairing.base,
                basePairing.mmproj,
                basePairing.quantization,
                basePairing.quantization,
                false // offload disabled by default
              );
            }
          } catch (pairingErr) {
            console.warn(`[downloadHuggingFaceModel] Vision pairing detection failed: ${pairingErr.message}`);
            // Don't fail the download if pairing detection fails
          }
        }

        downloadProgress.set(downloadId, {
          progress: 1,
          total: totalSize,
          current: totalSize,
          status: 'completed',
        });

        notifyDownloadComplete(filename, true);
        console.log(`[downloadHuggingFaceModel] Download completed: ${filename}`);
        resolve({ success: true, filename, filePath: modelPath });
      } catch (err) {
        console.error(`[downloadHuggingFaceModel] Download failed: ${err.message}`);
        const downloadId = `${repoId}/${filename}`;
        downloadProgress.set(downloadId, { status: 'error', error: err.message });
        lastMainError = { source: 'downloadHuggingFaceModel', message: err.message, time: new Date().toISOString() };
        notifyDownloadComplete(filename, false, err.message);
        reject(err);
      }
    });
  }

  // Legacy implementation (fallback)
  return new Promise((resolve, reject) => {
    const modelsDir = getModelsDirectory();
    const cleanRepoId = repoId
      .replace(/^https?:\/\/huggingface\.co\//, '')
      .replace(/\/$/, '')
      .trim();
    const downloadUrl = `https://huggingface.co/${cleanRepoId}/resolve/main/${filename}`;
    const modelPath = path.join(modelsDir, filename);

    // Check if file already exists
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      if (stats.size > 1024 * 1024) {
        resolve({ success: true, skipped: true, filename });
        return;
      }
    }

    const downloadId = `${cleanRepoId}/${filename}`;
    downloadProgress.set(downloadId, { progress: 0, total: 0, current: 0, status: 'downloading' });

    const headers = {};
    if (hfToken) {
      headers.Authorization = `Bearer ${hfToken}`;
    }

    const file = fs.createWriteStream(modelPath);

    https.get(downloadUrl, { headers }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 ||
          response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        https.get(redirectUrl, { headers }, (redirectResponse) => {
          handleDownloadResponse(redirectResponse, file, filename, downloadId, resolve, reject);
        }).on('error', (err) => {
          fs.unlink(modelPath, () => {});
          downloadProgress.set(downloadId, { status: 'error', error: err.message });
          lastMainError = { source: 'downloadHuggingFaceModel', message: err.message, time: new Date().toISOString() };
          reject(err);
        });
      } else {
        handleDownloadResponse(response, file, filename, downloadId, resolve, reject);
      }
    }).on('error', (err) => {
      fs.unlink(modelPath, () => {});
      downloadProgress.set(downloadId, { status: 'error', error: err.message });
      lastMainError = { source: 'downloadHuggingFaceModel', message: err.message, time: new Date().toISOString() };
      reject(err);
    });
  });
}

function handleDownloadResponse(response, file, filename, downloadId, resolve, reject) {
  if (response.statusCode !== 200) {
    fs.unlink(file.path || '', () => {});
    const errMsg = `Download failed: HTTP ${response.statusCode}`;
    downloadProgress.set(downloadId, { status: 'error', error: errMsg });
    lastMainError = { source: 'downloadHuggingFaceModel', message: errMsg, time: new Date().toISOString() };
    reject(new Error(errMsg));
    return;
  }

  const totalSize = parseInt(response.headers['content-length'], 10) || 0;
  let downloadedSize = 0;

  downloadProgress.set(downloadId, { progress: 0, total: totalSize, current: 0, status: 'downloading' });

  response.on('data', (chunk) => {
    downloadedSize += chunk.length;
    const progress = totalSize ? downloadedSize / totalSize : 0;
    downloadProgress.set(downloadId, {
      progress,
      total: totalSize,
      current: downloadedSize,
      status: 'downloading',
    });
  });

  response.pipe(file);

  file.on('finish', () => {
    file.close();
    downloadProgress.set(downloadId, {
      progress: 1,
      total: totalSize,
      current: totalSize,
      status: 'completed',
    });
    notifyDownloadComplete(filename, true);
    resolve({ success: true, filename });
  });

  file.on('error', (err) => {
    fs.unlink(file.path || '', () => {});
    downloadProgress.set(downloadId, { status: 'error', error: err.message });
    lastMainError = { source: 'downloadHuggingFaceModel', message: err.message, time: new Date().toISOString() };
    notifyDownloadComplete(filename, false, err.message);
    reject(err);
  });
}

function getDownloadProgress(downloadId) {
  return downloadProgress.get(downloadId) || null;
}

function getAllDownloadProgress() {
  // Include all statuses (downloading, completed, error) so the setup screen
  // can detect when downloads finish and auto-transition to the webui.
  // The webui Models tab also consumes this and was already tolerant of
  // non-downloading entries.
  const result = [];
  for (const [downloadId, progress] of downloadProgress.entries()) {
    result.push({ downloadId, ...progress });
  }
  return result;
}

function notifyDownloadComplete(filename, success, errorMessage) {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('download-complete', { filename, success, error: errorMessage || null });
    } catch (_) {
      // Window may have been destroyed
    }
  });
}

function deleteModel(filename) {
  const modelsDir = getModelsDirectory();
  const modelPath = path.join(modelsDir, filename);
  let deleted = false;
  if (fs.existsSync(modelPath)) {
    fs.unlinkSync(modelPath);
    deleted = true;
  }
  // Also delete the paired mmproj file if one exists
  const modelEntry = MODELS_TO_DOWNLOAD.find((m) => m.filename === filename);
  if (modelEntry && modelEntry.mmprojFilename) {
    const mmprojPath = path.join(modelsDir, modelEntry.mmprojFilename);
    if (fs.existsSync(mmprojPath)) {
      fs.unlinkSync(mmprojPath);
      deleted = true;
    }
  }
  // If the deleted model was the active one, clear its mmproj from store
  const activeModel = store.get('activeModelFilename', null);
  if (activeModel === filename) {
    store.delete('activeModelMmprojFilename');
  }
  return deleted;
}

function getStorageInfo() {
  const appDataDir = getAppDataDirectory();
  const modelsDir = getModelsDirectory();
  const chatsDir = getChatsDirectory();

  const getDirSize = (dir) => {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const fp = path.join(dir, f);
      const s = fs.statSync(fp);
      total += s.size;
    }
    return total;
  };

  return {
    appDataDir,
    modelsSize: getDirSize(modelsDir),
    chatsSize: getDirSize(chatsDir),
    totalSize: getDirSize(appDataDir),
  };
}

let loadingWindow = null;

function getLoadingWindowHtml(pngBase64, title = 'alpaca', message = 'Preparing your model...') {
  const imgHtml = pngBase64
    ? `<img src="data:image/png;base64,${pngBase64}" alt="alpaca" style="width:80px;height:80px;margin-bottom:16px;object-fit:contain;" />`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #0f0f0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      padding: 20px;
    }
    h1 { font-size: 1.2rem; font-weight: 600; margin-bottom: 6px; color: #fff; }
    p { font-size: 0.8rem; color: #999; margin-bottom: 20px; }
    .progress-track {
      width: 240px;
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: #10a37f;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .status { margin-top: 12px; font-size: 0.75rem; color: #666; }
  </style>
</head>
<body>
  ${imgHtml}
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
  <div class="status" id="status">Initializing...</div>
  <script>
    (function(){
      var stages = [
        {p: 10, msg: 'Copying model file...'},
        {p: 30, msg: 'Verifying model...'},
        {p: 60, msg: 'Preparing workspace...'},
        {p: 90, msg: 'Almost ready...'}
      ];
      var el = document.getElementById('progress');
      var st = document.getElementById('status');
      stages.forEach(function(s, i){
        setTimeout(function(){
          if(el) el.style.width = s.p + '%';
          if(st) st.textContent = s.msg;
        }, i * 800);
      });
    })();
  </script>
</body>
</html>`;
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const pngBase64 = getCachedAlpacaPngBase64();
  const html = getLoadingWindowHtml(pngBase64);
  // Write to a temp file to avoid data-URL size limits and encoding issues
  const tempHtmlPath = path.join(app.getPath('temp'), 'alpaca-loading.html');
  try {
    fs.writeFileSync(tempHtmlPath, html, 'utf8');
    loadingWindow.loadFile(tempHtmlPath);
  } catch (err) {
    console.error('Failed to write loading HTML, falling back to data URL:', err.message);
    loadingWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  }
  loadingWindow.once('ready-to-show', () => {
    loadingWindow.show();
  });
}

function closeLoadingWindow() {
  if (loadingWindow) {
    loadingWindow.close();
    loadingWindow = null;
  }
}


/**
 * Yield to the event loop so the UI remains responsive.
 */
async function yieldEventLoop() {
  return new Promise(r => setImmediate(r));
}

/**
 * Copy a file with real-time progress reporting.
 * Uses the OS-native fs.copyFile for maximum speed and minimal
 * memory/CPU usage, then polls file size for progress updates.
 * This avoids user-space streaming that can starve the event loop
 * and cause the loading window to freeze on large files.
 */
async function copyFileWithProgress(source, dest, onProgress) {
  const stats = fs.statSync(source);
  const totalBytes = stats.size;

  // Start native OS copy (non-blocking in the background)
  const copyPromise = fs.promises.copyFile(source, dest);

  // Poll destination file size for progress updates
  const startTime = Date.now();
  const pollInterval = 300; // ms
  let lastReported = 0;

  const pollProgress = setInterval(() => {
    try {
      const destStat = fs.statSync(dest);
      const copied = destStat.size;
      if (copied !== lastReported || copied === totalBytes) {
        lastReported = copied;
        if (onProgress) onProgress(copied, totalBytes);
      }
      if (copied >= totalBytes) {
        clearInterval(pollProgress);
      }
    } catch (_) {
      // File may not exist yet; ignore
    }
  }, pollInterval);

  try {
    await copyPromise;
    clearInterval(pollProgress);
    if (onProgress) onProgress(totalBytes, totalBytes);
  } catch (err) {
    clearInterval(pollProgress);
    throw err;
  }
}

/**
 * Update the loading window progress bar and status text.
 */
function updateLoadingWindowProgress(percent, message) {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  try {
    const js = `
      (function(){
        var el = document.getElementById('progress');
        var st = document.getElementById('status');
        if (el) el.style.width = '${percent}%';
        if (st) st.textContent = ${JSON.stringify(message)};
      })();
    `;
    loadingWindow.webContents.executeJavaScript(js);
  } catch (err) {
    // Loading window may not be ready yet; ignore
  }
}

async function copyDefaultModelIfNeeded() {
  const modelsDir = getModelsDirectory();
  let existingModels = [];
  try {
    existingModels = fs.readdirSync(modelsDir).filter(f => f.toLowerCase().endsWith('.gguf'));
  } catch (_) { /* directory may not exist yet */ }

  if (existingModels.length === 0) {
    const bundledModelPaths = [
      // Bundled inside asar (fs copy works on asar paths)
      path.join(__dirname, 'resources', 'models', 'Bonsai-4B.gguf'),
      // Unpacked resources/ (if ever added to asarUnpack)
      path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'models', 'Bonsai-4B.gguf'),
      // Fallback via process.resourcesPath
      path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'models', 'Bonsai-4B.gguf'),
      path.join(process.resourcesPath, 'app', 'resources', 'models', 'Bonsai-4B.gguf')
    ];

    for (const bundledPath of bundledModelPaths) {
      if (fs.existsSync(bundledPath)) {
        try {
          const destPath = path.join(modelsDir, 'Bonsai-4B.gguf');
          await copyFileWithProgress(bundledPath, destPath, (copied, total) => {
            const pct = total > 0 ? Math.round((copied / total) * 100) : 0;
            const mb = (copied / 1024 / 1024).toFixed(0);
            const totalMb = (total / 1024 / 1024).toFixed(0);
            updateLoadingWindowProgress(pct, `Copying model... ${mb} / ${totalMb} MB`);
          });
          console.log(`Copied default model to: ${destPath}`);
          return true;
        } catch (err) {
          console.error('Failed to copy default model:', err.message);
        }
      }
    }
  }
  return false;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.whenReady().then(async () => {
  getAppDataDirectory();

  // ============================================================================
  // PERFORMANCE: Parallelize independent initializations and show window ASAP
  // ============================================================================

  let secretVault = null;
  let keyDerivation = null;
  let hfModelService = null;
  let visionPairingManager = null;

  // Kick off security services and HF services in parallel since they are independent
  const securityInit = (async () => {
    try {
      console.log('[app.ready] Initializing Key_Derivation service...');
      const { KeyDerivation } = require('./key-derivation');
      const keyDerivationCachePath = path.join(getAppDataDirectory(), 'key-derivation-cache.json');
      keyDerivation = new KeyDerivation({ cachePath: keyDerivationCachePath });
      await keyDerivation.deriveMasterKey();
      console.log('[app.ready] Key_Derivation initialized successfully');
    } catch (err) {
      console.error('[app.ready] Key_Derivation initialization failed:', err.message);
      keyDerivation = null;
    }

    try {
      console.log('[app.ready] Initializing Secret_Vault service...');
      const { SecretVault } = require('./secret-vault');
      secretVault = new SecretVault(store, keyDerivation);
      await secretVault.initialize();
      console.log('[app.ready] Secret_Vault initialized successfully with backend:', secretVault.getEncryptionBackend());
      global.secretVault = secretVault;
      global.keyDerivation = keyDerivation;
    } catch (err) {
      console.error('[app.ready] Secret_Vault initialization failed:', err.message);
      secretVault = null;
    }
  })();

  const hfInit = (async () => {
    try {
      console.log('[app.ready] Initializing HuggingFace Model Service...');
      hfModelService = new HuggingFaceModelService(null, { logger: console });
      await hfModelService.initialize();
      console.log('[app.ready] HuggingFace Model Service initialized successfully');
      global.hfModelService = hfModelService;
    } catch (err) {
      console.error('[app.ready] HuggingFace Model Service initialization failed:', err.message);
      hfModelService = null;
    }

    try {
      console.log('[app.ready] Initializing Vision Pairing Manager...');
      visionPairingManager = new VisionPairingManager({ logger: console });
      console.log('[app.ready] Vision Pairing Manager initialized successfully');
      global.visionPairingManager = visionPairingManager;
    } catch (err) {
      console.error('[app.ready] Vision Pairing Manager initialization failed:', err.message);
      visionPairingManager = null;
    }
  })();

  // Wait for both security and HF initializations (they run in parallel)
  await Promise.all([securityInit, hfInit]);

  const modelsDir = getModelsDirectory();
  let existingModels = [];
  try {
    existingModels = fs.readdirSync(modelsDir).filter(f => f.toLowerCase().endsWith('.gguf'));
  } catch (_) {}

  if (existingModels.length === 0) {
    createLoadingWindow();
    // Give the loading window a tick to render before starting heavy I/O
    await new Promise(r => setTimeout(r, 150));

    // ------------------------------------------------------------------
    // Onboarding: copy bundled model + prepare voice services.
    // These are I/O-heavy operations. We run them sequentially but yield
    // to the event loop between steps so the loading window never freezes.
    // A 5-minute hard timeout prevents indefinite hangs if a download
    // stalls (e.g. no internet, proxy blocking GitHub).
    // ------------------------------------------------------------------
    const onboardingStart = Date.now();
    const ONBOARDING_TIMEOUT_MS = 5 * 60 * 1000;

    try {
      // Step 1: Copy default model
      updateLoadingWindowProgress(10, 'Preparing your model...');
      await yieldEventLoop();
      const copied = await Promise.race([
        copyDefaultModelIfNeeded(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Model copy timed out')), ONBOARDING_TIMEOUT_MS)
        )
      ]);
      if (copied) {
        updateLoadingWindowProgress(60, 'Model ready.');
        console.log('[app.ready] Default model copied successfully');
      } else {
        updateLoadingWindowProgress(60, 'No bundled model found — you can download one in Settings.');
        console.log('[app.ready] No bundled model to copy');
      }
      await yieldEventLoop();

      // Step 2: Set up voice recognition (non-blocking — we show progress
      // but don't let a failed/hung download stall the whole app).
      updateLoadingWindowProgress(70, 'Checking voice recognition...');
      const voiceService = new VoiceService({ app, store, logger: console });
      // init() is lightweight; it just detects paths — no heavy I/O
      await voiceService.init();
      await yieldEventLoop();

      // ensureSttReady can download from GitHub; give it its own timeout
      // and fire it in parallel so we can update the UI while it works.
      const voiceSetupPromise = voiceService.ensureSttReady({
        onProgress: (phase, current, total) => {
          const msg = phase === 'downloading-binary'
            ? 'Downloading speech engine...'
            : phase === 'downloading-model'
            ? `Downloading speech model... ${(current / 1024 / 1024).toFixed(0)} MB`
            : 'Setting up voice recognition...';
          updateLoadingWindowProgress(85, msg);
        }
      });

      const voiceSetupTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Voice setup timed out')), 180000)
      );

      try {
        await Promise.race([voiceSetupPromise, voiceSetupTimeout]);
        global.voiceService = voiceService;
        console.log('[app.ready] Voice Service ready after onboarding');
      } catch (voiceTimeoutErr) {
        console.warn('[app.ready] Voice Service setup timed out or failed:', voiceTimeoutErr.message);
        // Still assign the service so the UI can show "not ready" status
        global.voiceService = voiceService;
      }
      await yieldEventLoop();

      // Step 3: Download Bonsai Image 4B model files (diffusion GGUF,
      // text encoder, VAE) so image generation works out of the box.
      // This is non-blocking — if it fails, the user can retry from the
      // Image page or Settings → Bonsai Models.
      updateLoadingWindowProgress(95, 'Checking image generation models...');
      try {
        const bonsaiModelsMod = require('./bonsai-models');
        const imageMissing = bonsaiModelsMod.listMissingFiles(getModelsDirectory(), 'bonsai-image-4b');
        if (imageMissing.length > 0) {
          console.log(`[app.ready] Downloading bonsai-image-4b (${imageMissing.length} files)...`);
          for (const file of imageMissing) {
            const subdir = path.dirname(file.dest);
            if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
            const downloadId = `bonsai/bonsai-image-4b/${file.filename}`;
            const result = await downloadSingleFile(file.url, file.dest, downloadId, `bonsai-image-4b/${file.filename}`);
            if (result && result.success) {
              console.log(`[app.ready] Downloaded ${file.filename}`);
            } else if (result && result.skipped) {
              console.log(`[app.ready] Skipped ${file.filename} (already exists)`);
            } else {
              console.warn(`[app.ready] Failed to download ${file.filename}: ${result?.error || 'unknown'}`);
            }
          }
        } else {
          console.log('[app.ready] bonsai-image-4b model files already present');
        }
      } catch (imgErr) {
        console.warn('[app.ready] Image model download failed (non-blocking):', imgErr.message);
      }
      await yieldEventLoop();

      updateLoadingWindowProgress(100, 'Ready!');
      await new Promise(r => setTimeout(r, 300));
    } catch (onboardingErr) {
      console.error('[app.ready] Onboarding setup failed:', onboardingErr.message);
    } finally {
      const elapsed = Date.now() - onboardingStart;
      console.log(`[app.ready] Onboarding completed in ${elapsed}ms`);
      closeLoadingWindow();
    }
  }

  await createWindow();
  createTray();

  // Initialize and show migration dialog if needed (non-blocking)
  (async () => {
    try {
      if (secretVault) {
        const userMigration = new UserMigration(store, secretVault);
        const migrationDialogManager = new MigrationDialogManager(userMigration, store);

        const migrationResult = await migrationDialogManager.showDialogIfNeeded();
        if (migrationResult.success && migrationResult.migrated) {
          console.log('[app.ready] User migration completed successfully');
        } else if (migrationResult.cancelled) {
          console.log('[app.ready] User migration cancelled by user');
        }

        migrationDialogManager.destroy();
      } else {
        console.warn('[app.ready] Secret_Vault not available - skipping user migration');
      }
    } catch (err) {
      console.error('[app.ready] Migration dialog error:', err.message);
    }
  })();

  // Migrate API key from plain config to Secret_Vault (non-blocking)
  (async () => {
    try {
      if (secretVault) {
        const apiKeyMigration = new ApiKeyMigration(store, secretVault);
        if (apiKeyMigration.isMigrationNeeded()) {
          console.log('[app.ready] API key migration needed - starting migration');
          const migrationResult = await apiKeyMigration.migrate();
          console.log('[app.ready] API key migration completed:', migrationResult.message);
        } else {
          console.log('[app.ready] API key migration not needed');
        }
      } else {
        console.warn('[app.ready] Secret_Vault not available - skipping API key migration');
      }
    } catch (err) {
      console.error('[app.ready] API key migration error:', err.message);
    }
  })();

  // Detect hardware capabilities using cache first for fast startup.
  // If cache is stale (>24h), refresh in the background after window is shown.
  try {
    const cachedHw = store.get('hardwareCapabilities', null);
    if (cachedHw && !isHardwareCacheStale(cachedHw)) {
      console.log('Hardware capabilities loaded from cache:', formatHardwareSummary(cachedHw));
    } else {
      const hw = detectHardwareCapabilities();
      store.set('hardwareCapabilities', hw);
      console.log('Hardware capabilities detected:', formatHardwareSummary(hw));
    }
  } catch (err) {
    console.error('Hardware detection failed:', err.message);
  }

  // ============================================================================
  // Phase 1: Initialize llama.cpp Multi-Slot Orchestration
  // ============================================================================
  // Wire up the Phase 1 modules: GrammarLibrary, VramBudgetManager,
  // ModelConfigStore, SlotManager, ToolRewriter, and ApiGateway.
  // These are made globally available so they can be accessed by IPC handlers
  // and other modules throughout the app lifecycle.

  let grammarLibrary = null;
  let vramBudgetManager = null;
  let modelConfigStore = null;
  let slotManager = null;
  let toolRewriter = null;
  let apiGateway = null;

  try {
    console.log('[app.ready] Initializing Phase 1 modules...');

    // 1-3. Load Grammar Library, VRAM Budget Manager, and Model Config Store in parallel
    console.log('[app.ready] Loading Grammar Library...');
    const { GrammarLibrary } = require('./grammar-library');
    grammarLibrary = new GrammarLibrary({ grammarsDir: path.join(__dirname, 'grammars') });
    const grammarLoadPromise = grammarLibrary.load();

    console.log('[app.ready] Initializing VRAM Budget Manager...');
    const { VramBudgetManager } = require('./vram-budget-manager');
    vramBudgetManager = new VramBudgetManager();
    const cachedHw = store.get('hardwareCapabilities', null);
    let vramDetectPromise;
    if (cachedHw && (cachedHw.cuda || cachedHw.rocm || cachedHw.vulkan)) {
      // Fast-path: use cached GPU info to avoid blocking nvidia-smi/rocm-smi probes
      vramBudgetManager.detectionResult = {
        detected: true,
        totalMB: 0,
        reservedMB: 512,
        gpuCount: cachedHw.cuda ? 1 : 0,
        physicalCores: 0
      };
      console.log('[app.ready] VRAM Budget Manager fast-loaded from hardware cache');
      vramDetectPromise = Promise.resolve();
    } else {
      vramDetectPromise = vramBudgetManager.detect();
    }

    console.log('[app.ready] Initializing Model Config Store...');
    const { ModelConfigStore } = require('./model-config-store');
    modelConfigStore = new ModelConfigStore(store);
    // Reconcile stored configs with models on disk
    const modelsDir = getModelsDirectory();
    const modelsOnDisk = fs.readdirSync(modelsDir)
      .filter(f => f.toLowerCase().endsWith('.gguf') && !isMmprojFile(f));
    const modelConfigReconcilePromise = Promise.resolve().then(() => {
      modelConfigStore.reconcile(modelsOnDisk);
    });

    await Promise.all([grammarLoadPromise, vramDetectPromise, modelConfigReconcilePromise]);
    console.log('[app.ready] Grammar Library loaded successfully');
    global.grammarLibrary = grammarLibrary;
    console.log('[app.ready] VRAM Budget Manager initialized successfully');
    global.vramBudgetManager = vramBudgetManager;
    console.log('[app.ready] Model Config Store initialized successfully');
    global.modelConfigStore = modelConfigStore;

    // 4. Initialize Slot Manager
    console.log('[app.ready] Initializing Slot Manager...');
    const { SlotManager } = require('./model-slot-manager');
    slotManager = new SlotManager({ vramBudgetManager, modelConfigStore });
    await slotManager.init();
    console.log('[app.ready] Slot Manager initialized successfully');
    global.slotManager = slotManager;

    // 4b. Initialize Scheduler (Ollama-style model lifecycle)
    console.log('[app.ready] Initializing Scheduler...');
    scheduler = new Scheduler({
      vramBudgetManager,
      slotManager,
      store,
      logger: console,
      getAdvancedArgsFn: (modelFilename) => {
        if (modelConfigStore) {
          return modelConfigStore.getOrDefault(modelFilename);
        }
        return null;
      },
    });
    const schedulerInitPromise = scheduler.init().then(() => {
      console.log('[app.ready] Scheduler initialized successfully');
      global.scheduler = scheduler;

      // Forward scheduler events to renderer for UI reactivity
      scheduler.on('runner-state-changed', (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('runner-state-changed', evt);
        }
      });
      scheduler.on('runner-progress', (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('runner-progress', evt);
        }
      });
      scheduler.on('vram-updated', (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('vram-updated', evt);
        }
      });
      scheduler.on('config-changed', (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scheduler-config-changed', evt);
        }
      });
    });

    // 4a. Initialize Voice Service (deferred to avoid blocking startup)
    console.log('[app.ready] Initializing Voice Service...');
    const voiceService = new VoiceService({ app, store, logger: console });
    // Defer init to avoid blocking startup; voice features aren't needed immediately
    voiceService.init().then(async () => {
      console.log('[app.ready] Voice Service initialized successfully');
      global.voiceService = voiceService;
      // In the background, ensure binary + model are present so the mic
      // button works as soon as the user tries it.
      try {
        await voiceService.ensureSttReady();
        console.log('[app.ready] Voice Service STT ready (binary + model)');
      } catch (err) {
        console.warn('[app.ready] Voice Service STT background ensure failed:', err.message);
      }
    }).catch((err) => {
      console.warn('[app.ready] Voice Service initialization failed (deferred):', err.message);
    });


    // 4c. Initialize Knowledge Base
    console.log('[app.ready] Initializing Knowledge Base...');
    const knowledgeBase = new KnowledgeBase({ app, store, logger: console, embeddingPort: 13434 });
    knowledgeBase.init().then(() => {
      console.log('[app.ready] Knowledge Base initialized successfully');
      global.knowledgeBase = knowledgeBase;
    }).catch((err) => {
      console.warn('[app.ready] Knowledge Base initialization failed:', err.message);
    });

    // 4d. Initialize Workspace Manager
    console.log('[app.ready] Initializing Workspace Manager...');
    const workspaceManager = new WorkspaceManager({ app, store, logger: console });
    workspaceManager.init().then(() => {
      console.log('[app.ready] Workspace Manager initialized successfully');
      global.workspaceManager = workspaceManager;
    }).catch((err) => {
      console.warn('[app.ready] Workspace Manager initialization failed:', err.message);
    });


    // 4e. Initialize Launch Service
    console.log('[app.ready] Initializing Launch Service...');
    const launchService = new LaunchService({ app, store, logger: console });
    global.launchService = launchService;
    console.log('[app.ready] Launch Service ready');

    // 4b. Initialize Image Service (sd.cpp / Bonsai Image 4B)
    console.log('[app.ready] Initializing Image Service...');
    const imageService = new ImageService({ app, logger: console, hardwareCapabilities: getCachedHardwareCapabilities() });
    global.imageService = imageService;
    console.log('[app.ready] Image Service initialized');

    // 5. Initialize Tool Rewriter
    console.log('[app.ready] Initializing Tool Rewriter...');
    const { ToolRewriter } = require('./tool-rewriter');
    toolRewriter = new ToolRewriter();
    console.log('[app.ready] Tool Rewriter initialized successfully');
    global.toolRewriter = toolRewriter;

    // 6. Initialize API Gateway (parallel with scheduler)
    console.log('[app.ready] Initializing API Gateway...');
    const { ApiGateway } = require('./api-gateway');
    apiGateway = new ApiGateway({
      slotManager,
      vramBudgetManager,
      grammarLibrary,
      toolRewriter,
      // Expose model management functions via HTTP so the standalone webui
      // (running outside Electron) can search, download, list, and delete
      // models without the window.llamaAPI IPC bridge.
      desktopServices: {
        getInstalledModels,
        searchHuggingFaceRepo,
        downloadHuggingFaceModel,
        getDownloadProgress,
        deleteModel,
      },
      logger: console
    });
    const apiGatewayStartPromise = apiGateway.start().then(() => {
      console.log('[app.ready] API Gateway started successfully on port 13439');
      global.apiGateway = apiGateway;
    });

    await Promise.all([schedulerInitPromise, apiGatewayStartPromise]);

    console.log('[app.ready] Phase 1 modules initialized and wired successfully');
  } catch (err) {
    console.error('[app.ready] Phase 1 module initialization failed:', err.message);
    console.error('[app.ready] Stack:', err.stack);
    // Surface the error to the user via the main-error channel
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-error', {
        source: 'Phase 1 Initialization',
        message: `Failed to initialize llama.cpp orchestration: ${err.message}`,
        time: new Date().toISOString()
      });
    }
    // Continue anyway — the app can still function without the gateway
    // (though users won't be able to use the multi-slot features)
  }

  // Pre-download the correct llama.cpp backend in the background so it is
  // ready by the time the user finishes selecting / downloading a model.
  // This prevents the apparent hang where the app sits idle for 30-60 s
  // while the backend downloads after model selection.
  preloadBackend().catch((err) => {
    console.error('[app.ready] Backend preload error:', err.message);
  });

  // Don't auto-download models - let user do it manually from tray
  // Don't auto-start server - let user do it manually from tray
});

app.on('window-all-closed', () => {
  // Don't quit on window close, keep running in tray
});

/**
 * Centralised shutdown path used by every Quit menu item / accelerator.
 *
 * The previous implementation `await`-ed `stopLlamaServer` directly inside
 * the menu click handler before calling `app.exit(0)`. If the await took
 * longer than expected (Windows graceful shutdown can hang for ~5 s while
 * the Vulkan backend releases its swapchain) the user perceived the Quit
 * button as "doing nothing", and a stale `llama-server.exe` still bound to
 * port 13434 caused the next launch to freeze inside `waitForPortFree`.
 *
 * This helper instead:
 *   1. Marks the app as quitting so the main window's `close` handler
 *      stops re-hiding the window into the tray.
 *   2. Closes auxiliary windows (logs viewer, docs window, settings) and
 *      the docs static server so nothing keeps the event loop alive.
 *   3. Kicks off `stopLlamaServer` but always force-kills anything on the
 *      llama port and calls `app.exit(0)` after a 6 s safety timeout.
 */
function quitApplication() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.isQuitting = true;
  console.log('[quitApplication] Shutdown requested.');

  // Close auxiliary windows so they don't block the event loop after
  // app.exit() races with their close handlers.
  try { if (logsViewerWindow && !logsViewerWindow.isDestroyed()) logsViewerWindow.destroy(); } catch (_) { /* ignore */ }
  logsViewerWindow = null;

  let exited = false;
  const finalise = (code) => {
    if (exited) return;
    exited = true;
    // Destroy the tray icon — on Windows an active Tray keeps the event loop alive
    try { if (tray && !tray.isDestroyed()) tray.destroy(); } catch (_) { /* ignore */ }
    tray = null;
    // Force-close the main window so no hidden window blocks exit
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch (_) { /* ignore */ }
    mainWindow = null;
    // Force-kill any remaining llama-server processes (non-blocking)
    killProcessOnPort(13434);
    // Close docs server and sever any keep-alive connections
    try {
      if (docsServer) {
        if (typeof docsServer.closeAllConnections === 'function') docsServer.closeAllConnections();
        docsServer.close();
        docsServer = null;
        docsServerUrl = null;
        docsServerStartPromise = null;
      }
    } catch (_) { /* ignore */ }
    // Nuclear option: kill all llama-server.exe instances (non-blocking)
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec('taskkill /F /IM llama-server.exe', { windowsHide: true }, () => {});
    }
    app.exit(code);
    // Safety net: if app.exit() leaves the process alive (can happen on Windows
    // when the event loop has hidden handles), force-terminate after 500 ms.
    setTimeout(() => process.exit(code), 500);
  };

  // Hard safety net — Quit must always close the app within 5 s even if the
  // server stop path hangs (Windows GPU cleanup can stall for minutes).
  const SAFETY_MS = 5000;
  const safetyTimer = setTimeout(() => {
    console.warn(`[quitApplication] Graceful stop did not complete within ${SAFETY_MS} ms; forcing exit.`);
    finalise(0);
  }, SAFETY_MS);

  stopLlamaServer(3000)
    .then(() => {
      clearTimeout(safetyTimer);
      console.log('[quitApplication] llama-server stopped, exiting.');
      finalise(0);
    })
    .catch((err) => {
      clearTimeout(safetyTimer);
      console.error('[quitApplication] stopLlamaServer error:', err && err.message);
      finalise(1);
    });
}

/**
 * Shared cleanup that must run on every exit path. Destroys the tray icon
 * (which on Windows keeps the event loop alive), kills orphan llama-server
 * processes, and clears global references.
 */
function cleanupBeforeExit() {
  try { if (tray && !tray.isDestroyed()) tray.destroy(); } catch (_) { /* ignore */ }
  tray = null;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch (_) { /* ignore */ }
  mainWindow = null;
  try { if (logsViewerWindow && !logsViewerWindow.isDestroyed()) logsViewerWindow.destroy(); } catch (_) { /* ignore */ }
  logsViewerWindow = null;
  try {
    if (docsServer) {
      if (typeof docsServer.closeAllConnections === 'function') docsServer.closeAllConnections();
      docsServer.close();
      docsServer = null;
      docsServerUrl = null;
      docsServerStartPromise = null;
    }
  } catch (_) { /* ignore */ }
  killProcessOnPort(13434);
  llamaServerProcess = null;
  isServerRunning = false;

  // Clean up Phase 1 modules
  try {
    if (global.apiGateway) {
      console.log('[cleanupBeforeExit] Cleaning up API Gateway...');
      global.apiGateway = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.scheduler) {
      console.log('[cleanupBeforeExit] Cleaning up Scheduler...');
      global.scheduler = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.slotManager) {
      console.log('[cleanupBeforeExit] Cleaning up Slot Manager...');
      global.slotManager = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.vramBudgetManager) {
      console.log('[cleanupBeforeExit] Cleaning up VRAM Budget Manager...');
      global.vramBudgetManager = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.modelConfigStore) {
      console.log('[cleanupBeforeExit] Cleaning up Model Config Store...');
      global.modelConfigStore = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.grammarLibrary) {
      console.log('[cleanupBeforeExit] Cleaning up Grammar Library...');
      global.grammarLibrary = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.toolRewriter) {
      console.log('[cleanupBeforeExit] Cleaning up Tool Rewriter...');
      global.toolRewriter = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.voiceService) {
      console.log('[cleanupBeforeExit] Cleaning up Voice Service...');
      global.voiceService = null;
    }
  } catch (_) { /* ignore */ }

  // Clean up Secret_Vault and Key_Derivation services
  try {
    if (global.secretVault) {
      console.log('[cleanupBeforeExit] Cleaning up Secret_Vault...');
      global.secretVault = null;
    }
  } catch (_) { /* ignore */ }
  try {
    if (global.keyDerivation) {
      console.log('[cleanupBeforeExit] Cleaning up Key_Derivation...');
      global.keyDerivation = null;
    }
  } catch (_) { /* ignore */ }
}

app.on('before-quit', (event) => {
  if (isShuttingDown) return;
  app.isQuitting = true;
  event.preventDefault();
  isShuttingDown = true;

  console.log('[before-quit] Shutdown initiated...');

  // Two-phase shutdown per Requirement 5.5:
  // 1. Drain and close the API Gateway (stop accepting new connections, flush in-flight responses)
  // 2. Stop all slots via SlotManager
  // 3. Clean up and exit

  const performShutdown = async () => {
    try {
      // Phase 1: Drain and close the API Gateway
      if (global.apiGateway) {
        console.log('[before-quit] Draining and closing API Gateway...');
        try {
          await global.apiGateway.drainAndClose({ timeoutMs: 10_000 });
          console.log('[before-quit] API Gateway drained and closed');
        } catch (err) {
          console.error('[before-quit] API Gateway drain error:', err.message);
        }
      }

      // Phase 2: Stop all slots
      if (global.slotManager) {
        console.log('[before-quit] Stopping all slots...');
        try {
          await global.slotManager.stopAll();
          console.log('[before-quit] All slots stopped');
        } catch (err) {
          console.error('[before-quit] Slot Manager stop error:', err.message);
        }
      }

      // Phase 2b: Shutdown scheduler (terminates all tracked runners)
      if (scheduler) {
        console.log('[before-quit] Shutting down scheduler...');
        try {
          await scheduler.shutdown();
          console.log('[before-quit] Scheduler shut down');
        } catch (err) {
          console.error('[before-quit] Scheduler shutdown error:', err.message);
        }
      }

      // Phase 3: Stop legacy llama-server if still running
      if (llamaServerProcess) {
        console.log('[before-quit] Stopping legacy llama-server...');
        try {
          await stopLlamaServer(3000);
          console.log('[before-quit] Legacy llama-server stopped');
        } catch (err) {
          console.error('[before-quit] Legacy server stop error:', err.message);
        }
      }

      console.log('[before-quit] Shutdown complete, exiting now');
      cleanupBeforeExit();
      app.exit(0);
    } catch (err) {
      console.error('[before-quit] Unexpected error during shutdown:', err.message);
      cleanupBeforeExit();
      app.exit(1);
    }
  };

  // Safety timeout: if shutdown doesn't complete within 30 seconds, force exit
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  const shutdownTimer = setTimeout(() => {
    console.warn(`[before-quit] Shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS} ms; forcing exit`);
    cleanupBeforeExit();
    app.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  performShutdown().finally(() => {
    clearTimeout(shutdownTimer);
  });
});

app.on('will-quit', (event) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();

  console.log('[will-quit] Last-chance shutdown initiated...');

  const performShutdown = async () => {
    try {
      // Phase 1: Drain and close the API Gateway
      if (global.apiGateway) {
        console.log('[will-quit] Draining and closing API Gateway...');
        try {
          await global.apiGateway.drainAndClose({ timeoutMs: 5_000 });
          console.log('[will-quit] API Gateway drained and closed');
        } catch (err) {
          console.error('[will-quit] API Gateway drain error:', err.message);
        }
      }

      // Phase 2: Stop all slots
      if (global.slotManager) {
        console.log('[will-quit] Stopping all slots...');
        try {
          await global.slotManager.stopAll();
          console.log('[will-quit] All slots stopped');
        } catch (err) {
          console.error('[will-quit] Slot Manager stop error:', err.message);
        }
      }

      // Phase 2b: Shutdown scheduler
      if (scheduler) {
        console.log('[will-quit] Shutting down scheduler...');
        try {
          await scheduler.shutdown();
          console.log('[will-quit] Scheduler shut down');
        } catch (err) {
          console.error('[will-quit] Scheduler shutdown error:', err.message);
        }
      }

      // Phase 3: Stop legacy llama-server if still running
      if (llamaServerProcess) {
        console.log('[will-quit] Stopping legacy llama-server...');
        try {
          await stopLlamaServer(3000);
          console.log('[will-quit] Legacy llama-server stopped');
        } catch (err) {
          console.error('[will-quit] Legacy server stop error:', err.message);
        }
      }

      console.log('[will-quit] Shutdown complete, exiting now');
      cleanupBeforeExit();
      app.exit(0);
    } catch (err) {
      console.error('[will-quit] Unexpected error during shutdown:', err.message);
      cleanupBeforeExit();
      app.exit(1);
    }
  };

  // Safety timeout: if shutdown doesn't complete within 15 seconds, force exit
  const SHUTDOWN_TIMEOUT_MS = 15_000;
  const shutdownTimer = setTimeout(() => {
    console.warn(`[will-quit] Shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS} ms; forcing exit`);
    cleanupBeforeExit();
    app.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  performShutdown().finally(() => {
    clearTimeout(shutdownTimer);
  });
});

app.on('quit', () => {
  cleanupBeforeExit();
});

// ============================================================================
// User Authentication
// ============================================================================

const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function registerUser(username, password, email, bio) {
  const users = store.get('users', []);
  if (users.find(u => u.username === username)) {
    return { success: false, error: 'Username already exists' };
  }
  const newUser = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    email: email || '',
    bio: bio || '',
    avatar: '',
    createdAt: Date.now()
  };
  users.push(newUser);
  store.set('users', users);
  // Auto-login after registration
  const { passwordHash, ...safeUser } = newUser;
  store.set('currentUser', safeUser);
  return { success: true, user: safeUser };
}

function loginUser(username, password) {
  const users = store.get('users', []);
  const user = users.find(u => u.username === username);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  if (user.passwordHash !== hashPassword(password)) {
    return { success: false, error: 'Invalid password' };
  }
  const { passwordHash, ...safeUser } = user;
  store.set('currentUser', safeUser);
  return { success: true, user: safeUser };
}

function getCurrentUser() {
  return store.get('currentUser', null);
}

function logoutUser() {
  store.delete('currentUser');
  return { success: true };
}

function updateUserProfile(updates) {
  const currentUser = store.get('currentUser', null);
  if (!currentUser) {
    return { success: false, error: 'Not logged in' };
  }
  const users = store.get('users', []);
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx === -1) {
    return { success: false, error: 'User not found' };
  }
  const allowed = ['email', 'bio', 'avatar'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      users[idx][key] = updates[key];
      currentUser[key] = updates[key];
    }
  }
  store.set('users', users);
  store.set('currentUser', currentUser);
  return { success: true, user: currentUser };
}

// ============================================================================
// Provider Credentials (Secure per-user storage)
// ============================================================================

/**
 * Get stored provider credentials for the currently logged-in user.
 * Returns an error if no user is authenticated.
 */
function getProviderCredentials() {
  const currentUser = store.get('currentUser', null);
  if (!currentUser) {
    return { success: false, error: 'Authentication required. Please log in or register to store provider credentials.' };
  }

  const allCredentials = store.get('providerCredentials', {});
  const userCredentials = allCredentials[currentUser.id] || [];

  // Decrypt API keys before returning
  return {
    success: true,
    providers: userCredentials.map((provider) => {
      let apiKey = provider.apiKey;
      if (apiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const encryptedBuffer = Buffer.from(apiKey, 'base64');
          apiKey = safeStorage.decryptString(encryptedBuffer);
        } catch (err) {
          console.error(`[provider-credentials] Failed to decrypt API key for provider ${provider.id}:`, err.message);
          apiKey = '';
        }
      }
      return { ...provider, apiKey };
    })
  };
}

/**
 * Save or update a provider credential for the current user.
 * API keys are encrypted with safeStorage before persisting.
 */
function setProviderCredential(id, name, baseUrl, apiKey, models) {
  const currentUser = store.get('currentUser', null);
  if (!currentUser) {
    return { success: false, error: 'Authentication required. Please log in or register to store provider credentials.' };
  }

  const allCredentials = store.get('providerCredentials', {});
  const userCredentials = allCredentials[currentUser.id] || [];

  // Encrypt API key if provided and safeStorage is available
  let encryptedKey = '';
  if (apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      encryptedKey = safeStorage.encryptString(apiKey).toString('base64');
    } catch (err) {
      console.error('[provider-credentials] Failed to encrypt API key:', err.message);
      return { success: false, error: 'Failed to securely store API key.' };
    }
  } else if (apiKey) {
    return { success: false, error: 'Secure storage is not available on this system.' };
  }

  const existingIndex = userCredentials.findIndex((p) => p.id === id);
  const now = Date.now();
  const provider = {
    id,
    name,
    baseUrl,
    apiKey: encryptedKey,
    models: models || [],
    updatedAt: now
  };

  if (existingIndex >= 0) {
    provider.createdAt = userCredentials[existingIndex].createdAt;
    userCredentials[existingIndex] = provider;
  } else {
    provider.createdAt = now;
    userCredentials.push(provider);
  }

  allCredentials[currentUser.id] = userCredentials;
  store.set('providerCredentials', allCredentials);

  return { success: true, provider: { ...provider, apiKey: apiKey || '' } };
}

/**
 * Delete a provider credential for the current user.
 */
function deleteProviderCredential(id) {
  const currentUser = store.get('currentUser', null);
  if (!currentUser) {
    return { success: false, error: 'Authentication required. Please log in or register to manage provider credentials.' };
  }

  const allCredentials = store.get('providerCredentials', {});
  const userCredentials = allCredentials[currentUser.id] || [];
  const filtered = userCredentials.filter((p) => p.id !== id);

  if (filtered.length === userCredentials.length) {
    return { success: false, error: 'Provider not found.' };
  }

  allCredentials[currentUser.id] = filtered;
  store.set('providerCredentials', allCredentials);

  return { success: true };
}

// ============================================================================
// Web Search
// ============================================================================

/**
 * Resolve DuckDuckGo redirect URLs to the actual destination.
 * DDG wraps every result in //duckduckgo.com/l/?uddg=<encoded_url>
 * so we decode the uddg parameter to get the real URL.
 */
function resolveDdgUrl(raw) {
  if (!raw) return raw;
  const uddg = raw.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try { return decodeURIComponent(uddg[1]); } catch (_) { /* fallthrough */ }
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

async function performWebSearch(query, maxResults = 5) {
  return new Promise((resolve) => {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = [];
          // Simple regex extraction of DuckDuckGo results
          const resultBlocks = data.match(/<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g) || [];
          const snippetBlocks = data.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g) || [];
          for (let i = 0; i < Math.min(resultBlocks.length, maxResults); i++) {
            const linkMatch = resultBlocks[i].match(/href="([^"]+)"/);
            const titleMatch = resultBlocks[i].replace(/<[^>]+>/g, ' ').trim();
            const snippetMatch = snippetBlocks[i] ? snippetBlocks[i].replace(/<[^>]+>/g, ' ').trim() : '';
            if (linkMatch) {
              results.push({
                title: titleMatch,
                url: resolveDdgUrl(linkMatch[1]),
                snippet: snippetMatch
              });
            }
          }
          resolve({ success: true, results });
        } catch (err) {
          console.error('Web search parsing error:', err);
          resolve({ success: false, error: 'Failed to parse search results' });
        }
      });
    }).on('error', (err) => {
      console.error('Web search request error:', err);
      resolve({ success: false, error: 'Failed to perform web search' });
    });
  });
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWebPage(rawUrl) {
  try {
    // Node.js fetch cannot parse protocol-relative URLs (//host/path).
    // Fix them up before the request.
    let url = rawUrl;
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        // Accept-Encoding is intentionally omitted — Node.js undici handles
        // automatic decompression and may skip it if the header is explicit.
        'Cache-Control': 'no-cache',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const text = extractTextFromHtml(html);
    return { success: true, content: text.substring(0, 12000), url };
  } catch (err) {
    console.error('Fetch page error:', err);
    return { success: false, error: err.message || 'Failed to fetch page' };
  }
}

// IPC handlers for renderer process
ipcMain.handle('get-server-status', () => {
  return isServerRunning;
});

ipcMain.handle('get-hardware-info', () => {
  return getCachedHardwareCapabilities();
});

ipcMain.handle('refresh-hardware-detection', () => {
  const fresh = detectHardwareCapabilities();
  store.set('hardwareCapabilities', fresh);
  console.log('Hardware detection refreshed:', formatHardwareSummary(fresh));
  return fresh;
});

ipcMain.handle('start-server', async () => {
  const started = await startLlamaServer();
  return started && isServerRunning;
});

ipcMain.handle('stop-server', async () => {
  await stopLlamaServer();
  return !isServerRunning;
});

ipcMain.handle('start-lazy-server', async () => {
  /**
   * Starts llama-server on demand when the user clicks "Start Chatting"
   * from the lazy-start landing page. Mirrors the boot flow from
   * createWindow but is triggered by user action rather than at launch.
   */
  if (!mainWindow) return { success: false, error: 'Main window not available' };

  const validModel = checkModelsExist();
  if (!validModel) {
    return { success: false, error: 'No model found' };
  }

  // Activate scheduler (moves from dormant to active)
  if (scheduler) {
    try {
      await scheduler.activate();
    } catch (err) {
      console.warn('[start-lazy-server] Scheduler activation error:', err.message);
    }
  }

  const serverStarted = await startLlamaServer();
  if (!serverStarted) {
    return { success: false, error: 'Failed to start llama-server' };
  }

  const apiUrl = apiServer.getApiUrl();
  try {
    await waitForServerReady(`${apiUrl}/`, 120000);
    mainWindow.loadURL(apiUrl);
    return { success: true };
  } catch (err) {
    console.error('[start-lazy-server] Server failed to become ready:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-lazy-start-settings', () => {
  const mgr = createLazyStartManager(store);
  return {
    enabled: mgr.isEnabled(),
    autoShutdownDelayMinutes: mgr.getAutoShutdownDelayMinutes()
  };
});

ipcMain.handle('set-lazy-start-enabled', (event, enabled) => {
  const mgr = createLazyStartManager(store);
  mgr.setEnabled(enabled);
  return mgr.isEnabled();
});

ipcMain.handle('download-models', () => {
  // Fire-and-forget so the renderer UI stays responsive during multi-GB downloads
  downloadModels().catch((err) => {
    console.error('Background download error:', err);
  });
  return true;
});

ipcMain.handle('get-models-directory', () => {
  return getModelsDirectory();
});

ipcMain.handle('set-selected-models', (event, modelNames) => {
  setSelectedModels(modelNames);
  return true;
});

ipcMain.handle('get-selected-models', () => {
  return store.get('selectedModels', []);
});

// App data directory IPC handlers
ipcMain.handle('get-app-data-directory', () => {
  return getAppDataDirectory();
});

ipcMain.handle('open-data-folder', () => {
  shell.openPath(getAppDataDirectory());
});

// Model management IPC handlers
ipcMain.handle('get-installed-models', () => {
  return getInstalledModels();
});

// ---------------------------------------------------------------------------
// Bonsai model catalog IPC handlers
//
// Exposes the bonsai-beach model definitions (bonsai-27b, bonsai-8b,
// bonsai-image-4b, bonsai-tts, bonsai-stt) to the onboarding/models UI so
// the prerequisite bonsai models can be discovered and downloaded.
// ---------------------------------------------------------------------------
ipcMain.handle('bonsai:list-models', () => {
  return bonsaiModels.listBonsaiModels();
});

ipcMain.handle('bonsai:list-chat-models', () => {
  return bonsaiModels.listBonsaiChatModels();
});

ipcMain.handle('bonsai:get-image-model', () => {
  return bonsaiModels.getBonsaiImageModel() || null;
});

ipcMain.handle('bonsai:list-missing-files', (event, modelId) => {
  return bonsaiModels.listMissingFiles(getModelsDirectory(), modelId);
});

ipcMain.handle('bonsai:download-model', async (event, modelId) => {
  // Downloads every missing file for the given bonsai model id (or all
  // enabled models when modelId is null). Files are fetched from the
  // HuggingFace URLs recorded in desktop/bonsai-models.js and placed in
  // the appropriate subdirectory under the user's models directory.
  const missing = bonsaiModels.listMissingFiles(getModelsDirectory(), modelId);
  if (missing.length === 0) return { success: true, skipped: true, downloaded: 0 };

  let downloaded = 0;
  const errors = [];
  for (const file of missing) {
    const subdir = path.dirname(file.dest);
    if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
    const downloadId = `bonsai/${file.modelId}/${file.filename}`;
    try {
      const result = await downloadSingleFile(file.url, file.dest, downloadId, `${file.modelId}/${file.filename}`);
      if (result && result.success) {
        downloaded++;
      } else if (result && result.error) {
        errors.push({ filename: file.filename, error: result.error });
      }
    } catch (err) {
      errors.push({ filename: file.filename, error: String(err) });
    }
  }
  return { success: errors.length === 0, downloaded, errors };
});

ipcMain.handle('bonsai:get-download-progress', (event, modelId) => {
  // Aggregate progress across all files for a given bonsai model id.
  const prefix = `bonsai/${modelId}/`;
  const entries = [];
  for (const [id, val] of downloadProgress.entries()) {
    if (id.startsWith(prefix)) entries.push({ id, ...val });
  }
  return entries;
});

ipcMain.handle('get-active-model', () => {
  const filename = store.get('activeModelFilename', null);
  if (!filename) return null;
  const modelEntry = MODELS_TO_DOWNLOAD.find((m) => m.filename === filename);
  const mmprojFilename = store.get('activeModelMmprojFilename', null) || (modelEntry ? modelEntry.mmprojFilename : null);
  const mmprojPath = mmprojFilename ? path.join(getModelsDirectory(), mmprojFilename) : null;
  const mmprojExists = mmprojPath ? fs.existsSync(mmprojPath) : false;
  return {
    filename,
    mmprojFilename: mmprojExists ? mmprojFilename : null,
    hasVision: mmprojExists || !!(modelEntry && modelEntry.hasVision),
  };
});

ipcMain.handle('delete-model', (event, filename) => {
  return deleteModel(filename);
});

ipcMain.handle('import-local-model', async () => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select a local GGUF model file',
    filters: [
      { name: 'GGUF Models', extensions: ['gguf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const srcPath = result.filePaths[0];
  const modelsDir = getModelsDirectory();
  const filename = path.basename(srcPath);
  const destPath = path.join(modelsDir, filename);

  let finalFilename = filename;
  let finalDestPath = destPath;
  if (fs.existsSync(destPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(finalDestPath)) {
      finalFilename = base + '_' + counter + ext;
      finalDestPath = path.join(modelsDir, finalFilename);
      counter++;
    }
  }

  try {
    fs.copyFileSync(srcPath, finalDestPath);
    const stats = fs.statSync(finalDestPath);
    if (stats.size <= 1024 * 1024) {
      fs.unlinkSync(finalDestPath);
      return { success: false, error: 'Imported file is too small or incomplete' };
    }

    store.set('activeModelFilename', finalFilename);
    store.delete('activeModelMmprojFilename');

    console.log('[import-local-model] Imported and activated: ' + finalFilename);
    return {
      success: true,
      filename: finalFilename,
      size: stats.size,
      sizeFormatted: formatFileSize(stats.size)
    };
  } catch (err) {
    console.error('[import-local-model] Error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('import-vision-model', async () => {
  if (!mainWindow) return { canceled: true };

  const baseResult = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select the base GGUF model file',
    filters: [
      { name: 'GGUF Models', extensions: ['gguf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (baseResult.canceled || baseResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const mmprojResult = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select the vision projector (mmproj) GGUF file',
    filters: [
      { name: 'GGUF Models', extensions: ['gguf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (mmprojResult.canceled || mmprojResult.filePaths.length === 0) {
    return { canceled: true, message: 'Mmproj selection canceled' };
  }

  const baseSrc = baseResult.filePaths[0];
  const mmprojSrc = mmprojResult.filePaths[0];
  const modelsDir = getModelsDirectory();

  const baseFilename = path.basename(baseSrc);
  const mmprojFilename = path.basename(mmprojSrc);
  const baseDest = path.join(modelsDir, baseFilename);
  const mmprojDest = path.join(modelsDir, mmprojFilename);

  try {
    let finalBaseFilename = baseFilename;
    let finalBaseDest = baseDest;
    if (fs.existsSync(baseDest)) {
      const ext = path.extname(baseFilename);
      const baseName = path.basename(baseFilename, ext);
      let counter = 1;
      while (fs.existsSync(finalBaseDest)) {
        finalBaseFilename = baseName + '_' + counter + ext;
        finalBaseDest = path.join(modelsDir, finalBaseFilename);
        counter++;
      }
    }
    fs.copyFileSync(baseSrc, finalBaseDest);
    const baseStats = fs.statSync(finalBaseDest);
    if (baseStats.size <= 1024 * 1024) {
      fs.unlinkSync(finalBaseDest);
      return { success: false, error: 'Base model file is too small or incomplete' };
    }

    let finalMmprojFilename = mmprojFilename;
    let finalMmprojDest = mmprojDest;
    if (fs.existsSync(mmprojDest)) {
      const ext = path.extname(mmprojFilename);
      const baseName = path.basename(mmprojFilename, ext);
      let counter = 1;
      while (fs.existsSync(finalMmprojDest)) {
        finalMmprojFilename = baseName + '_' + counter + ext;
        finalMmprojDest = path.join(modelsDir, finalMmprojFilename);
        counter++;
      }
    }
    fs.copyFileSync(mmprojSrc, finalMmprojDest);
    const mmprojStats = fs.statSync(finalMmprojDest);
    if (mmprojStats.size <= 1024 * 1024) {
      fs.unlinkSync(finalMmprojDest);
      return { success: false, error: 'Mmproj file is too small or incomplete' };
    }

    if (global.visionPairingManager) {
      try {
        await global.visionPairingManager.storeModelPair(
          finalBaseFilename,
          finalMmprojFilename,
          false
        );
        console.log('[import-vision-model] Stored pairing: ' + finalBaseFilename + ' <-> ' + finalMmprojFilename);
      } catch (pairingErr) {
        console.warn('[import-vision-model] Failed to store pairing:', pairingErr.message);
      }
    }

    store.set('activeModelFilename', finalBaseFilename);
    store.set('activeModelMmprojFilename', finalMmprojFilename);

    console.log('[import-vision-model] Imported and activated: ' + finalBaseFilename + ' + ' + finalMmprojFilename);
    return {
      success: true,
      filename: finalBaseFilename,
      mmprojFilename: finalMmprojFilename,
      size: baseStats.size,
      sizeFormatted: formatFileSize(baseStats.size)
    };
  } catch (err) {
    console.error('[import-vision-model] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// HuggingFace search and download IPC handlers
ipcMain.handle('search-huggingface', async (event, repoId, hfToken) => {
  return searchHuggingFaceRepo(repoId, hfToken);
});

ipcMain.handle('download-huggingface-model', async (event, repoId, filename, hfToken) => {
  const cleanRepoId = repoId
    .replace(/^https?:\/\/huggingface\.co\//, '')
    .replace(/\/$/, '')
    .trim();
  const downloadId = `${cleanRepoId}/${filename}`;

  // Start download in background so the UI can poll progress via get-download-progress
  downloadHuggingFaceModel(repoId, filename, hfToken).catch((err) => {
    console.error('Background download failed:', err);
  });

  return { downloadId, started: true };
});

ipcMain.handle('get-download-progress', (event, downloadId) => {
  return getDownloadProgress(downloadId);
});

ipcMain.handle('get-last-error', () => {
  return lastMainError || null;
});

ipcMain.handle('copy-log-path', () => {
  try {
    const logPath = getServicesLogPath();
    clipboard.writeText(logPath);
    return { success: true, path: logPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Service log viewer IPC. Returns the tail of the log file (capped to the
// last 256 KB) so the in-app monitor can hydrate on open without loading
// gigabyte-sized logs into the renderer. Live updates stream via
// `logs:append` from `appendLog`.
ipcMain.handle('logs:get-initial', () => {
  try {
    const logPath = getServicesLogPath();
    if (!fs.existsSync(logPath)) return { path: logPath, content: '' };
    const stat = fs.statSync(logPath);
    const MAX_BYTES = 256 * 1024;
    const start = stat.size > MAX_BYTES ? stat.size - MAX_BYTES : 0;
    const fd = fs.openSync(logPath, 'r');
    try {
      const length = stat.size - start;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      return { path: logPath, content: buf.toString('utf8'), truncated: start > 0 };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { path: getServicesLogPath(), content: '', error: err.message };
  }
});

ipcMain.handle('logs:open-file', () => {
  const logPath = getServicesLogPath();
  shell.openPath(logPath);
  return { path: logPath };
});

ipcMain.handle('logs:reveal-in-folder', () => {
  const logPath = getServicesLogPath();
  shell.showItemInFolder(logPath);
  return { path: logPath };
});

// Documentation viewer IPC — lets the chat webui sidebar trigger the
// bundled docs window via window.llamaAPI.openDocumentation(path).
ipcMain.handle('docs:open', (_event, docPath) => {
  try {
    openDocumentationWindow(typeof docPath === 'string' ? docPath : '');
    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('get-all-download-progress', () => {
  return getAllDownloadProgress();
});

// Storage info IPC handler
ipcMain.handle('get-storage-info', () => {
  return getStorageInfo();
});

// Broadcast model-switch progress to all renderers (settings + main chat).
function broadcastSwitchStatus(payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('model-switch-status', payload);
    }
  }
}

// Switch active model and restart server
ipcMain.handle('switch-model', async (event, filename) => {
  console.log(`[switch-model] IPC called for: ${filename}`);
  const modelsDir = getModelsDirectory();
  const modelPath = path.join(modelsDir, filename);
  console.log(`[switch-model] Checking model path: ${modelPath}`);
  if (!fs.existsSync(modelPath)) {
    console.error(`[switch-model] Model file not found: ${modelPath}`);
    return { success: false, error: 'Model file not found' };
  }
  const stats = fs.statSync(modelPath);
  if (stats.size <= 1024 * 1024) {
    console.error(`[switch-model] Model file too small: ${stats.size} bytes`);
    return { success: false, error: 'Model file is too small or incomplete' };
  }

  console.log(`[switch-model] Setting activeModelFilename to: ${filename}`);
  store.set('activeModelFilename', filename);

  // Store (or clear) the paired mmproj filename so startLlamaServer can match it
  const modelEntry = MODELS_TO_DOWNLOAD.find((m) => m.filename === filename);
  if (modelEntry && modelEntry.mmprojFilename) {
    store.set('activeModelMmprojFilename', modelEntry.mmprojFilename);
    console.log(`[switch-model] Stored mmproj filename: ${modelEntry.mmprojFilename}`);
  } else {
    store.delete('activeModelMmprojFilename');
    console.log('[switch-model] Cleared stored mmproj filename (model has no paired mmproj)');
  }

  // Attempt zero-cost switch via scheduler first
  if (scheduler) {
    try {
      const runner = await scheduler.switchModel(modelPath);
      if (runner && runner.process) {
        llamaServerProcess = runner.process;
        isServerRunning = true;
        broadcastSwitchStatus({ phase: 'ready', filename });
        return { success: true, restarted: false, scheduler: true };
      }
    } catch (schedErr) {
      console.warn('[switch-model] Scheduler switch failed, falling back to legacy restart:', schedErr.message);
    }
  }

  // Restart server if it's running
    const apiCfg = apiServer.getApiConfig();
    const serverPort = apiCfg.port || 13434;
    const apiUrl = apiServer.getApiUrl();
    const portBusy = await isPortInUse(serverPort);
    console.log(`[switch-model] llamaServerProcess: ${!!llamaServerProcess}, portBusy: ${portBusy}`);
    if (llamaServerProcess || portBusy) {
      console.log(`Gracefully switching to model: ${filename}`);
      try {
        broadcastSwitchStatus({ phase: 'stopping', filename });
        // 1. Stop the old server gracefully and wait for process exit
        await stopLlamaServer(15000);

        // 1b. Aggressively kill any remaining process on the port
        killProcessOnPort(serverPort);

        // 2. Wait for port to be fully freed (old process + children gone)
        try {
          await waitForPortFree(serverPort, 10000);
        } catch (e) {
          console.warn('Port not fully freed after stop, forcing another kill');
          killProcessOnPort(serverPort);
          await waitForPortFree(serverPort, 10000);
        }

        // 3. Start new server with the new model
        broadcastSwitchStatus({ phase: 'starting', filename });
        const started = await startLlamaServer();
        if (!started) {
          broadcastSwitchStatus({ phase: 'error', filename, error: 'Failed to start server with new model' });
          return { success: false, error: 'Failed to start server with new model' };
        }

        // 4. Wait for new server to be ready before telling UI it's done
        broadcastSwitchStatus({ phase: 'waiting-ready', filename });
        await waitForServerReady(`${apiUrl}/`, 120000);
        console.log(`Server ready with model: ${filename}`);

        // 5. Reload the main chat window so the SSE connection is re-established
        // against the freshly-restarted server.
        if (mainWindow && !mainWindow.isDestroyed()) {
          const currentUrl = mainWindow.webContents.getURL();
          if (currentUrl.startsWith(apiUrl)) {
            mainWindow.webContents.reload();
          }
        }

      broadcastSwitchStatus({ phase: 'ready', filename });
      return { success: true, restarted: true, ready: true };
    } catch (err) {
      console.error('Model switch failed:', err.message);
      // Attempt cleanup if something went wrong
      try {
        await stopLlamaServer(5000);
      } catch (_) { /* ignore cleanup errors */ }
      broadcastSwitchStatus({ phase: 'error', filename, error: err.message });
      return { success: false, error: err.message };
    }
  }

  broadcastSwitchStatus({ phase: 'ready', filename });
  return { success: true, restarted: false };
});

async function transitionToMainApp() {
  if (!mainWindow) return;

  // Always surface progress to the user while we finish preparing the
  // backend. Even when preload has already completed we show a brief
  // "Preparing…" message so the window never appears hung (Windows marks
  // it "Not Responding" if the renderer has nothing to paint while the
  // main process is doing work).
  const caps = getCachedHardwareCapabilities();
  const backendName = binaryManager.mapCapabilitiesToBackend(caps);
  const backendDownloadId = `__backend__/${backendName}`;

  if (!isServerRunning) {
    const bundled = findLlamaServerBinary();
    if (!bundled) {
      // No cached or bundled binary yet — explicitly tell the user we are
      // fetching it, then await the preload (kicks off if not started).
      showMainWindowLoading('alpaca', `Downloading llama.cpp backend (${backendName})…`);
      try {
        await preloadBackend();
      } catch (err) {
        console.error('[transitionToMainApp] Backend preload failed:', err.message);
      }
    } else if (backendPreloadPromise) {
      const beProgress = downloadProgress.get(backendDownloadId);
      if (beProgress && (beProgress.status === 'downloading' || beProgress.status === 'extracting')) {
        showMainWindowLoading('alpaca', `Downloading llama.cpp backend (${backendName})…`);
        try {
          await backendPreloadPromise;
        } catch (err) {
          console.error('[transitionToMainApp] Backend preload failed:', err.message);
        }
      }
    }
  }

  const validModel = checkModelsExist();
  if (validModel) {
    if (!isServerRunning) {
      showMainWindowLoading('alpaca', 'Starting llama-server…');
      const started = await startLlamaServer();
      if (!started) {
        const setupHtmlPath = getSetupHtmlPath();
        const setupHtml = getSetupHtml(generateModelOptions());
        try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (err) {
          console.error('Failed to write setup.html:', err.message);
        }
        if (fs.existsSync(setupHtmlPath)) mainWindow.loadFile(setupHtmlPath);
        return;
      }
    }
    const apiUrl = apiServer.getApiUrl();
    showMainWindowLoading('alpaca', 'Loading AI model, this may take a moment...');
    try {
      await waitForServerReady(`${apiUrl}/`, 120000);
      showMainWindowLoading('alpaca', 'Launching chat...');
      mainWindow.loadURL(apiUrl);
    } catch (err) {
      console.error('[transitionToMainApp] Server failed to become ready:', err.message);
      const setupHtmlPath = getSetupHtmlPath();
      const setupHtml = getSetupHtml(generateModelOptions());
      try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (e) {
        console.error('Failed to write setup.html:', e.message);
      }
      if (fs.existsSync(setupHtmlPath)) mainWindow.loadFile(setupHtmlPath);
    }
  } else {
    const setupHtmlPath = getSetupHtmlPath();
    const setupHtml = getSetupHtml(generateModelOptions());
    try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (err) {
      console.error('Failed to write setup.html:', err.message);
    }
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    }
  }
}

// ============================================================
// Embedded jCodeMunch MCP Client
// ============================================================
// Spawns jcodemunch-mcp as a stdio subprocess and communicates
// via JSON-RPC 2.0. Provides structured code retrieval for web
// search results, file uploads, and local workspace folders.
//
// Uses a bundled standalone binary if available (no Python required),
// otherwise falls back to system Python 3.10+ with jcodemunch-mcp.
// Storage:  %APPDATA%/alpaca/jcodemunch/
//

let jcmProcess = null;
let jcmRequestId = 0;
const jcmPending = new Map();
let jcmInitialized = false;
let jcmCapabilities = null;
let jcmStoragePath = path.join(getAppDataDirectory(), 'jcodemunch');

function ensureJcmStorage() {
  if (!fs.existsSync(jcmStoragePath)) {
    fs.mkdirSync(jcmStoragePath, { recursive: true });
  }
  return jcmStoragePath;
}

function detectPython() {
  const candidates = ['python3', 'python', 'py'];
  for (const bin of candidates) {
    try {
      const out = execSync(`${bin} --version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`[JCM] Found ${bin}: ${out.trim()}`);
      return bin;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function detectJcmModule(pythonBin) {
  try {
    execSync(`${pythonBin} -c "import jcodemunch_mcp"`, { timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function getBundledJcmBinary() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binaryName = isWin
    ? 'jcodemunch-mcp.exe'
    : isMac
      ? 'jcodemunch-mcp-macos'
      : 'jcodemunch-mcp-linux';

  const possiblePaths = [
    // Packaged app with asarUnpack
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', binaryName),
    // Packaged app / development
    path.join(__dirname, 'bin', binaryName),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getJcmCommand() {
  // Prefer bundled standalone binary (no Python required)
  const bundled = getBundledJcmBinary();
  if (bundled) {
    return { binary: bundled, args: [] };
  }

  // Fallback: system Python + pip-installed module
  const python = detectPython();
  if (!python) {
    return { error: 'Python not found. Install Python 3.10+ or bundle jcodemunch-mcp binary to use built-in code retrieval.' };
  }
  if (!detectJcmModule(python)) {
    return { error: 'jcodemunch-mcp not found. Run: pip install jcodemunch-mcp, or bundle the standalone binary.' };
  }
  return { binary: python, args: ['-m', 'jcodemunch_mcp.server'] };
}

async function startJcmClient() {
  if (jcmProcess && !jcmProcess.killed) {
    return { success: true, message: 'Already running' };
  }

  const cmd = getJcmCommand();
  if (cmd.error) {
    return { success: false, error: cmd.error };
  }

  ensureJcmStorage();

  const env = {
    ...process.env,
    JCODEMUNCH_STORAGE_PATH: jcmStoragePath,
    JCODEMUNCH_USE_AI_SUMMARIES: 'false',
  };

  try {
    jcmProcess = spawn(cmd.binary, cmd.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });

    jcmProcess.stderr.on('data', (data) => {
      appendLog('jcm', data);
    });

    jcmProcess.on('exit', (code) => {
      console.log(`[JCM] Process exited with code ${code}`);
      jcmInitialized = false;
      jcmProcess = null;
    });

    jcmProcess.on('error', (err) => {
      console.error('[JCM] Process error:', err);
      jcmInitialized = false;
      jcmProcess = null;
    });

    // Read JSON-RPC responses
    let buffer = '';
    jcmProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id !== undefined && jcmPending.has(msg.id)) {
            const { resolve, reject } = jcmPending.get(msg.id);
            jcmPending.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          }
        } catch (err) {
          console.warn('[JCM] Failed to parse line:', trimmed.slice(0, 200), err.message);
        }
      }
    });

    // Wait a moment for process to start
    await new Promise((r) => setTimeout(r, 500));

    // Send initialize
    const initResult = await jcmSendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'alpaca', version: '1.0.0' },
    });

    jcmCapabilities = initResult?.capabilities;
    jcmInitialized = true;

    // Send initialized notification
    jcmSendNotification('notifications/initialized', {});

    console.log('[JCM] Initialized successfully');
    return { success: true };
  } catch (err) {
    console.error('[JCM] Failed to start:', err);
    return { success: false, error: err.message };
  }
}

function stopJcmClient() {
  if (jcmProcess && !jcmProcess.killed) {
    jcmProcess.kill();
    jcmProcess = null;
  }
  jcmInitialized = false;
  jcmCapabilities = null;
}

function jcmSendNotification(method, params) {
  if (!jcmProcess || jcmProcess.killed) return;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  jcmProcess.stdin.write(msg + '\n');
}

function jcmSendRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!jcmProcess || jcmProcess.killed) {
      reject(new Error('jCodeMunch process not running'));
      return;
    }
    const id = ++jcmRequestId;
    jcmPending.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    jcmProcess.stdin.write(msg + '\n');

    // Timeout
    setTimeout(() => {
      if (jcmPending.has(id)) {
        jcmPending.delete(id);
        reject(new Error(`jCodeMunch request timeout: ${method}`));
      }
    }, 30000);
  });
}

async function jcmCallTool(toolName, args) {
  if (!jcmInitialized) {
    const startRes = await startJcmClient();
    if (!startRes.success) {
      return { success: false, error: startRes.error };
    }
  }
  try {
    const result = await jcmSendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });
    // Extract text content from MCP result
    let contentText = '';
    let isError = false;
    if (result && result.content) {
      for (const item of result.content) {
        if (item.type === 'text') {
          contentText += item.text;
        }
      }
      isError = !!result.isError;
    }
    return { success: !isError, content: contentText, raw: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Higher-level helpers
async function jcmIndexRepo(repoUrl) {
  return jcmCallTool('index_repo', { url: repoUrl });
}

async function jcmIndexFolder(folderPath) {
  // Normalize path for Windows
  const normalized = path.resolve(folderPath);
  return jcmCallTool('index_folder', { path: normalized });
}

async function jcmSearchSymbols(repo, query, maxResults = 10, kind) {
  const args = { repo, query, max_results: maxResults };
  if (kind) args.kind = kind;
  return jcmCallTool('search_symbols', args);
}

async function jcmGetSymbolSource(repo, symbolId) {
  return jcmCallTool('get_symbol_source', { repo, symbol_id: symbolId });
}

async function jcmListRepos() {
  return jcmCallTool('list_repos', {});
}

async function jcmGetRepoOutline(repo) {
  return jcmCallTool('get_repo_outline', { repo });
}

async function jcmGetFileTree(repo, pathPrefix = '') {
  return jcmCallTool('get_file_tree', { repo, path_prefix: pathPrefix });
}

async function jcmGetFileContent(repo, filePath) {
  return jcmCallTool('get_file_content', { repo, file_path: filePath });
}

async function jcmGetContextBundle(repo, symbolId, includeCallers = false) {
  return jcmCallTool('get_context_bundle', { repo, symbol_id: symbolId, include_callers: includeCallers });
}

async function jcmGetFileOutline(repo, filePath) {
  return jcmCallTool('get_file_outline', { repo, file_path: filePath });
}

async function jcmInvalidateCache(repo) {
  return jcmCallTool('invalidate_cache', { repo });
}

// Health check
async function jcmHealthCheck() {
  const cmd = getJcmCommand();
  if (cmd.error) {
    return { available: false, error: cmd.error };
  }
  if (!jcmInitialized) {
    const startRes = await startJcmClient();
    return { available: startRes.success, error: startRes.error };
  }
  return { available: true };
}

// ============================================================

// Go back to main UI (chat or setup) from settings
ipcMain.handle('go-back-to-main', async () => {
  try {
    await transitionToMainApp();
  } catch (err) {
    console.error('[go-back-to-main] transitionToMainApp failed:', err && err.message);
  }
});

// User authentication IPC handlers
ipcMain.handle('register-user', (event, username, password, email, bio) => {
  return registerUser(username, password, email, bio);
});

ipcMain.handle('login-user', (event, username, password) => {
  return loginUser(username, password);
});

ipcMain.handle('get-current-user', () => {
  return getCurrentUser();
});

ipcMain.handle('logout-user', () => {
  return logoutUser();
});

ipcMain.handle('update-user-profile', (event, updates) => {
  return updateUserProfile(updates);
});

// Provider credentials IPC handlers
ipcMain.handle('get-provider-credentials', () => {
  return getProviderCredentials();
});

ipcMain.handle('set-provider-credential', (event, id, name, baseUrl, apiKey, models) => {
  return setProviderCredential(id, name, baseUrl, apiKey, models);
});

ipcMain.handle('delete-provider-credential', (event, id) => {
  return deleteProviderCredential(id);
});

// Secret_Vault IPC handlers
ipcMain.handle('vault:getSecret', async (event, key) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    const secret = await global.secretVault.getSecret(key);
    return { success: true, value: secret };
  } catch (error) {
    console.error(`[vault:getSecret] Error retrieving secret "${key}":`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:setSecret', async (event, key, value, options = {}) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    await global.secretVault.setSecret(key, value, options);
    console.log(`[vault:setSecret] Secret "${key}" stored successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[vault:setSecret] Error storing secret "${key}":`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:deleteSecret', async (event, key) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    await global.secretVault.deleteSecret(key);
    console.log(`[vault:deleteSecret] Secret "${key}" deleted successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[vault:deleteSecret] Error deleting secret "${key}":`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:getSecretMetadata', async (event, key) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    const metadata = await global.secretVault.getSecretMetadata(key);
    return { success: true, metadata };
  } catch (error) {
    console.error(`[vault:getSecretMetadata] Error retrieving metadata for "${key}":`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:listSecrets', async (event) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    const secrets = global.secretVault.listSecrets();
    return { success: true, secrets };
  } catch (error) {
    console.error('[vault:listSecrets] Error listing secrets:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:refreshToken', async (event, key, refreshFn) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    // Note: refreshFn cannot be passed directly via IPC, so this handler
    // expects the caller to provide a refresh endpoint or handle refresh externally
    throw new Error('Token refresh must be handled by the caller with a refresh function');
  } catch (error) {
    console.error(`[vault:refreshToken] Error refreshing token "${key}":`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:verifyMasterKeyChecksum', async (event) => {
  try {
    if (!global.secretVault) {
      throw new Error('Secret_Vault not initialized');
    }
    const isValid = await global.secretVault.verifyMasterKeyChecksum();
    return { success: true, isValid };
  } catch (error) {
    console.error('[vault:verifyMasterKeyChecksum] Error verifying checksum:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:isInitialized', async (event) => {
  try {
    if (!global.secretVault) {
      return { success: true, initialized: false };
    }
    return { success: true, initialized: global.secretVault.isInitialized() };
  } catch (error) {
    console.error('[vault:isInitialized] Error checking initialization:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vault:getEncryptionBackend', async (event) => {
  try {
    if (!global.secretVault) {
      return { success: true, backend: null };
    }
    const backend = global.secretVault.getEncryptionBackend();
    return { success: true, backend };
  } catch (error) {
    console.error('[vault:getEncryptionBackend] Error getting backend:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Vision Pairing Manager IPC handlers
// ============================================================================

ipcMain.handle('vision:getModelPair', async (event, baseModel) => {
  try {
    if (!global.visionPairingManager) {
      return { success: false, error: 'Vision Pairing Manager not initialized' };
    }
    const pairing = await global.visionPairingManager.getModelPair(baseModel);
    return { success: true, pairing };
  } catch (error) {
    console.error(`[vision:getModelPair] Error getting pairing for ${baseModel}:`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vision:getAllPairs', async (event) => {
  try {
    if (!global.visionPairingManager) {
      return { success: false, error: 'Vision Pairing Manager not initialized' };
    }
    const pairs = await global.visionPairingManager.getAllPairs();
    return { success: true, pairs };
  } catch (error) {
    console.error('[vision:getAllPairs] Error getting all pairs:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vision:updateOffloadFlag', async (event, baseModel, offload) => {
  try {
    if (!global.visionPairingManager) {
      return { success: false, error: 'Vision Pairing Manager not initialized' };
    }
    await global.visionPairingManager.updateOffloadFlag(baseModel, offload);
    return { success: true };
  } catch (error) {
    console.error(`[vision:updateOffloadFlag] Error updating offload flag for ${baseModel}:`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vision:deletePair', async (event, baseModel) => {
  try {
    if (!global.visionPairingManager) {
      return { success: false, error: 'Vision Pairing Manager not initialized' };
    }
    await global.visionPairingManager.deletePair(baseModel);
    return { success: true };
  } catch (error) {
    console.error(`[vision:deletePair] Error deleting pair for ${baseModel}:`, error.message);
    return { success: false, error: error.message };
  }
});

// Web search IPC handlers
ipcMain.handle('web-search', async (event, query, maxResults) => {
  return performWebSearch(query, maxResults);
});

ipcMain.handle('fetch-web-page', async (event, url) => {
  return fetchWebPage(url);
});

// Embedded jCodeMunch IPC handlers
ipcMain.handle('jcm-health-check', async () => {
  return jcmHealthCheck();
});

ipcMain.handle('jcm-index-repo', async (event, repoUrl) => {
  return jcmIndexRepo(repoUrl);
});

ipcMain.handle('jcm-index-folder', async (event, folderPath) => {
  return jcmIndexFolder(folderPath);
});

ipcMain.handle('jcm-search-symbols', async (event, repo, query, maxResults, kind) => {
  return jcmSearchSymbols(repo, query, maxResults, kind);
});

ipcMain.handle('jcm-get-symbol-source', async (event, repo, symbolId) => {
  return jcmGetSymbolSource(repo, symbolId);
});

ipcMain.handle('jcm-list-repos', async () => {
  return jcmListRepos();
});

ipcMain.handle('jcm-get-repo-outline', async (event, repo) => {
  return jcmGetRepoOutline(repo);
});

ipcMain.handle('jcm-get-file-tree', async (event, repo, pathPrefix) => {
  return jcmGetFileTree(repo, pathPrefix);
});

ipcMain.handle('jcm-get-file-content', async (event, repo, filePath) => {
  return jcmGetFileContent(repo, filePath);
});

ipcMain.handle('jcm-get-context-bundle', async (event, repo, symbolId, includeCallers) => {
  return jcmGetContextBundle(repo, symbolId, includeCallers);
});

ipcMain.handle('jcm-get-file-outline', async (event, repo, filePath) => {
  return jcmGetFileOutline(repo, filePath);
});

ipcMain.handle('jcm-invalidate-cache', async (event, repo) => {
  return jcmInvalidateCache(repo);
});

// Local folder picker for workspace indexing
ipcMain.handle('select-local-folder', async () => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a local folder to index for code context',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, folderPath: result.filePaths[0] };
});

// ============================================================================
// API Server Settings IPC handlers
// ============================================================================

ipcMain.handle('get-api-settings', () => {
  const cfg = apiServer.getApiConfig();
  return {
    ...cfg,
    openAIEndpoint: apiServer.getApiOpenAIEndpoint(),
  };
});

ipcMain.handle('set-api-settings', (event, settings) => {
  try {
    const updated = apiServer.setApiConfig(settings);
    return { success: true, config: updated };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Health Check & API Monitoring IPC handlers
// ============================================================================

/**
 * Health check endpoint - provides server status for monitoring and load balancers.
 * Returns comprehensive status information about the llama.cpp server and API.
 */
ipcMain.handle('api:health', async () => {
  const apiUrl = apiServer.getApiUrl();
  if (!apiUrl || !isServerRunning) {
    return {
      status: 'unavailable',
      message: 'Server is not running',
      timestamp: new Date().toISOString()
    };
  }

  try {
    // Quick check to see if the server responds
    const healthCheckPromise = new Promise((resolve, reject) => {
      const req = http.get(`${apiUrl}/`, (res) => {
        req.destroy();
        resolve({ 
          status: 'healthy', 
          statusCode: res.statusCode,
          modelLoaded: res.statusCode === 200 
        });
      });
      
      req.on('error', (err) => {
        req.destroy();
        resolve({ 
          status: 'degraded', 
          message: `Connection issue: ${err.message}`,
          modelLoaded: false
        });
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ 
          status: 'degraded', 
          message: 'Health check timed out',
          modelLoaded: false
        });
      });
    });

    const health = await healthCheckPromise;
    
    // Add additional metadata
    const uptime = process.uptime ? process.uptime() : 0;
    const memoryUsage = process.memoryUsage ? process.memoryUsage() : {};
    
    return {
      ...health,
      uptime_seconds: Math.floor(uptime),
      memory_usage_mb: Math.round((memoryUsage.heapUsed || 0) / 1024 / 1024),
      timestamp: new Date().toISOString(),
      api_url: apiUrl,
      server_running: isServerRunning,
      last_error: lastMainError ? {
        source: lastMainError.source,
        message: lastMainError.message,
        time: lastMainError.time
      } : null
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Health check failed: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * Token counting endpoint - estimates token count for a given conversation.
 * Useful for validating requests before sending to prevent context overflow.
 */
ipcMain.handle('api:count-tokens', async (event, messages, model) => {
  const apiUrl = apiServer.getApiUrl();
  if (!apiUrl) {
    throw new Error('API server not configured');
  }

  try {
    // Use a simple heuristic for token counting if the server doesn't support it directly
    // This is a fallback; ideally llama.cpp would support a /token/count endpoint
    let totalTokens = 0;
    
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const content = msg.content || '';
        // Rough approximation: ~4 characters per token for English text
        // This is a conservative estimate
        const estimatedTokens = Math.ceil(content.length / 3.5);
        totalTokens += estimatedTokens;
        // Add overhead for role and formatting (~4 tokens per message)
        totalTokens += 4;
      }
    }

    return {
      token_count: totalTokens,
      estimated: true,
      model: model || 'default',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Token counting error:', error);
    throw error;
  }
});

/**
 * Queue status endpoint - returns request queue and circuit breaker status.
 * Useful for monitoring system load and capacity.
 */
ipcMain.handle('api:queue-status', () => {
  try {
    const { getRequestQueue } = require('./request-manager');
    const queue = getRequestQueue();
    return {
      success: true,
      status: queue.getStatus(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// ============================================================================
// Backend Management IPC handlers
// ============================================================================

ipcMain.handle('get-installed-backends', () => {
  return binaryManager.getInstalledBackends(app);
});

ipcMain.handle('check-for-backend-update', async () => {
  try {
    const release = await binaryManager.getLatestReleaseInfo();
    return { success: true, tag: release.tag, source: release.source };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-backend', async (event, backend, version) => {
  try {
    const caps = getCachedHardwareCapabilities();
    const targetBackend = backend || binaryManager.mapCapabilitiesToBackend(caps);
    const targetVersion = version || 'latest';

    console.log(`[download-backend] Requested backend: ${targetBackend}, version: ${targetVersion}`);

    const result = await binaryManager.ensureBackend(app, caps, (current, total) => {
      const pct = total ? Math.round((current / total) * 100) : 0;
      console.log(`[binary-manager] Download progress: ${pct}% (${(current / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`);
    });

    return {
      success: true,
      backend: result.backend,
      tag: result.tag,
      exePath: result.exePath,
      backendDir: result.backendDir,
      fresh: result.fresh,
    };
  } catch (err) {
    console.error('[download-backend] Failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-current-backend-info', () => {
  return getCurrentBackendInfo();
});

function parseTagNumber(tag) {
  return parseInt(String(tag).replace(/\D/g, ''), 10) || 0;
}

function broadcastBackendUpdateProgress(payload) {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('backend-update-progress', payload);
      }
    } catch (_) {
      // Window may have been destroyed
    }
  });
}

ipcMain.handle('update-backend', async (event) => {
  try {
    const current = getCurrentBackendInfo();
    const release = await binaryManager.getLatestReleaseInfo();
    const latestTag = release.tag;
    const currentNum = parseTagNumber(current.tag);
    const latestNum = parseTagNumber(latestTag);

    if (current.tag && latestNum <= currentNum) {
      return {
        success: true,
        updated: false,
        message: `Already on the latest backend (${current.tag}).`,
        currentTag: current.tag,
        latestTag,
      };
    }

    console.log(`[update-backend] Update available: ${current.tag || 'none'} -> ${latestTag}. Downloading...`);
    const caps = getCachedHardwareCapabilities();
    const wasRunning = isServerRunning && !!llamaServerProcess;

    broadcastBackendUpdateProgress({ phase: 'checking', message: 'Checking for latest release...' });

    const result = await binaryManager.ensureBackend(
      app,
      caps,
      (currentBytes, total) => {
        const pct = total ? Math.round((currentBytes / total) * 100) : 0;
        broadcastBackendUpdateProgress({
          phase: 'downloading',
          progress: pct,
          currentBytes,
          totalBytes: total,
          message: `Downloading backend... ${pct}%`
        });
      },
      (status) => {
        if (status.phase === 'downloading') {
          broadcastBackendUpdateProgress({
            phase: 'downloading',
            progress: 0,
            message: 'Starting download...'
          });
        } else if (status.phase === 'extracting') {
          broadcastBackendUpdateProgress({
            phase: 'extracting',
            progress: 100,
            message: 'Extracting backend...'
          });
        }
      }
    );

    if (!result.fresh && current.tag === result.tag) {
      broadcastBackendUpdateProgress({ phase: 'ready', message: 'Backend is already up to date.' });
      return {
        success: true,
        updated: false,
        message: `Backend ${result.tag} is already cached and up to date.`,
        currentTag: current.tag,
        latestTag: result.tag,
        exePath: result.exePath,
      };
    }

    broadcastBackendUpdateProgress({ phase: 'downloaded', message: `Backend ${result.tag} downloaded.` });

    // Restart server if it was running so the new binary is picked up.
    if (wasRunning) {
      console.log('[update-backend] Server was running; restarting to pick up new binary...');
      broadcastBackendUpdateProgress({ phase: 'restarting', progress: 0, message: 'Stopping server...' });

      const apiCfg = apiServer.getApiConfig();
      const serverPort = apiCfg.port || 13434;
      const apiUrl = apiServer.getApiUrl();

      await stopLlamaServer(15000);
      killProcessOnPort(serverPort);
      try {
        await waitForPortFree(serverPort, 10000);
      } catch (e) {
        killProcessOnPort(serverPort);
        await waitForPortFree(serverPort, 10000);
      }

      broadcastBackendUpdateProgress({ phase: 'restarting', progress: 50, message: 'Starting server with new backend...' });

      const started = await startLlamaServer();
      if (!started) {
        broadcastBackendUpdateProgress({ phase: 'error', message: 'Server failed to restart.' });
        return {
          success: false,
          error: 'Backend downloaded but server failed to restart.',
          currentTag: current.tag,
          latestTag: result.tag,
        };
      }
      await waitForServerReady(`${apiUrl}/`, 120000);

      broadcastBackendUpdateProgress({ phase: 'ready', progress: 100, message: `Server is ready with ${result.tag}.` });

      // Reload the main chat window so the SSE connection is re-established
      if (mainWindow && !mainWindow.isDestroyed()) {
        const currentUrl = mainWindow.webContents.getURL();
        if (currentUrl.startsWith(apiUrl)) {
          mainWindow.webContents.reload();
        }
      }
    } else {
      broadcastBackendUpdateProgress({ phase: 'ready', progress: 100, message: `Updated to ${result.tag}. Server will use the new version on next start.` });
    }

    return {
      success: true,
      updated: true,
      message: wasRunning
        ? `Updated to ${result.tag} and restarted server.`
        : `Updated to ${result.tag}. Server will use the new version on next start.`,
      currentTag: current.tag,
      latestTag: result.tag,
      exePath: result.exePath,
      restarted: wasRunning,
    };
  } catch (err) {
    console.error('[update-backend] Failed:', err.message);
    broadcastBackendUpdateProgress({ phase: 'error', message: err.message });
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Per-repo release check & update IPC handlers
// Allows the Providers UI to check/update llama.cpp (bonsai variant),
// llama.cpp (upstream), and sd.cpp independently.
// ============================================================================

// Check release from a specific repo (bonsai variant or upstream llama.cpp)
ipcMain.handle('check-release-for-repo', async (event, repo) => {
  try {
    if (!repo || typeof repo !== 'string') {
      return { success: false, error: 'repo parameter is required' };
    }
    const release = await binaryManager.getLatestReleaseInfoForRepo(repo);
    return { success: true, tag: release.tag, source: release.source, repo: release.repo, assets: (release.assets || []).map(a => a.name) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get/set the llama.cpp repo preference (bonsai vs upstream)
ipcMain.handle('get-repo-preference', () => {
  return { preference: binaryManager.getRepoPreference() };
});

ipcMain.handle('set-repo-preference', async (event, pref) => {
  try {
    binaryManager.setRepoPreference(pref);
    store.set('llamaCppRepoPreference', pref);
    return { success: true, preference: pref };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// sd.cpp release check & update
ipcMain.handle('check-sd-cpp-update', async () => {
  try {
    const release = await binaryManager.getLatestReleaseInfoForRepo(binaryManager.SD_CPP_RELEASE);
    const current = binaryManager.getSdBackendInfo(app);
    return { success: true, tag: release.tag, currentTag: current.tag, installed: current.installed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-sd-backend-info', () => {
  return binaryManager.getSdBackendInfo(app);
});

ipcMain.handle('update-sd-backend', async (event) => {
  try {
    const current = binaryManager.getSdBackendInfo(app);
    const release = await binaryManager.getLatestReleaseInfoForRepo(binaryManager.SD_CPP_RELEASE);
    const latestTag = release.tag;

    if (current.installed && current.tag === latestTag) {
      return { success: true, updated: false, message: `sd.cpp is already up to date (${latestTag}).`, currentTag: current.tag, latestTag };
    }

    broadcastBackendUpdateProgress({ phase: 'downloading', progress: 0, message: `Downloading sd.cpp ${latestTag}...` });

    // Remove old binary so ensureSdBackend re-downloads
    const exeName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
    const binDir = binaryManager.getSdBinDir(app);
    const oldPath = path.join(binDir, exeName);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (_) { /* ignore */ }
    }

    const caps = getCachedHardwareCapabilities();
    const sdPath = await binaryManager.ensureSdBackend(app, {
      onProgress: (pct) => {
        broadcastBackendUpdateProgress({ phase: 'downloading', progress: pct, message: `Downloading sd.cpp... ${pct}%` });
      },
      hardwareCapabilities: caps
    });

    broadcastBackendUpdateProgress({ phase: 'ready', progress: 100, message: `sd.cpp updated to ${latestTag}.` });

    // Update the image service if it's initialized
    if (global.imageService) {
      global.imageService.sdCliPath = sdPath;
      global.imageService._ready = false; // force re-check on next generate
    }

    return { success: true, updated: true, message: `sd.cpp updated to ${latestTag}.`, currentTag: current.tag, latestTag, path: sdPath };
  } catch (err) {
    console.error('[update-sd-backend] Failed:', err.message);
    broadcastBackendUpdateProgress({ phase: 'error', message: err.message });
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Experimental Bonsai feature toggles (4-bit KV cache, speculative decoding)
// Stored in electron-store as `bonsaiExperimental` = { kv4: bool, speculative: bool }
// Applied by startLlamaServer when a bonsai model preset is matched.
// ============================================================================

ipcMain.handle('get-bonsai-experimental', () => {
  return store.get('bonsaiExperimental', { kv4: false, speculative: false });
});

ipcMain.handle('set-bonsai-experimental', async (event, opts) => {
  try {
    const current = store.get('bonsaiExperimental', { kv4: false, speculative: false });
    const updated = {
      kv4: !!(opts && opts.kv4),
      speculative: !!(opts && opts.speculative),
    };
    store.set('bonsaiExperimental', updated);
    console.log(`[bonsai-experimental] Updated: kv4=${updated.kv4}, speculative=${updated.speculative}`);
    return { success: true, options: updated };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Check if the dspark drafter is available for the active model
ipcMain.handle('check-dspark-drafter', async () => {
  try {
    const modelsDir = getModelsDir();
    const chatDir = path.join(modelsDir, 'chat');
    if (!fs.existsSync(chatDir)) return { success: true, available: false };
    const files = fs.readdirSync(chatDir);
    const drafter = files.find(f => /dspark[-_]Q4_1/i.test(f) && f.endsWith('.gguf'));
    return { success: true, available: !!drafter, filename: drafter || null };
  } catch (err) {
    return { success: false, error: err.message, available: false };
  }
});

// ============================================================================
// Voice Service IPC handlers
// ============================================================================

ipcMain.handle('voice:getStatus', () => {
  try {
    if (!global.voiceService) {
      return { success: true, status: { sttReady: false, ttsReady: false, ttsMode: 'browser' } };
    }
    return { success: true, status: global.voiceService.status };
  } catch (error) {
    console.error('[voice:getStatus] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('voice:transcribe', async (event, base64Audio, format) => {
  try {
    if (!global.voiceService) {
      throw new Error('Voice service not initialized');
    }
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    const result = await global.voiceService.transcribe(audioBuffer, format);
    return { success: true, text: result.text, language: result.language };
  } catch (error) {
    console.error('[voice:transcribe] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('voice:synthesize', async (event, text, options) => {
  try {
    if (!global.voiceService) {
      throw new Error('Voice service not initialized');
    }
    const result = await global.voiceService.synthesize(text, options);
    if (result.mode === 'moss' && result.audioBuffer) {
      return {
        success: true,
        mode: 'moss',
        audioBase64: result.audioBuffer.toString('base64'),
        mimeType: result.mimeType
      };
    }
    return { success: true, mode: 'browser' };
  } catch (error) {
    console.error('[voice:synthesize] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('voice:downloadModel', async (event, modelName, url) => {
  try {
    if (!global.voiceService) {
      throw new Error('Voice service not initialized');
    }
    const result = await global.voiceService.downloadWhisperModel(modelName, url);
    return { success: result.success, skipped: result.skipped, error: result.error };
  } catch (error) {
    console.error('[voice:downloadModel] Error:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Image Service IPC handlers (sd.cpp / Bonsai Image 4B)
//
// Provides local image generation via the sd-cli binary and the Bonsai Image
// 4B diffusion model. Mirrors the image generation flow in
// bonsai-beach/crates/bonsai-beach/src/openai_proxy.rs.
// ============================================================================

ipcMain.handle('image:getStatus', () => {
  if (!global.imageService) return { success: false, error: 'image service not initialized' };
  try {
    return { success: true, status: global.imageService.getStatus() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('image:ensureReady', async () => {
  if (!global.imageService) return { success: false, error: 'image service not initialized' };
  try {
    const result = await global.imageService.ensureReady();
    return { success: true, ...result };
  } catch (error) {
    console.error('[image:ensureReady] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('image:generate', async (event, params) => {
  if (!global.imageService) return { success: false, error: 'image service not initialized' };
  try {
    const result = await global.imageService.generateImage(params || {});
    return result;
  } catch (error) {
    console.error('[image:generate] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('image:openImageFolder', () => {
  if (!global.imageService || !app) return { success: false, error: 'image service not initialized' };
  try {
    const dir = path.join(app.getPath('userData'), 'images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// ============================================================================
// Scheduler IPC handlers
// ============================================================================

ipcMain.handle('scheduler:get-loaded-models', () => {
  if (!scheduler) return [];
  return scheduler.getLoadedModels();
});

ipcMain.handle('scheduler:get-runner-state', (event, modelPath) => {
  if (!scheduler) return null;
  return scheduler.getRunnerState(modelPath);
});

ipcMain.handle('scheduler:preload-models', async (event, filenames) => {
  if (!scheduler) return { success: false, error: 'Scheduler not initialized' };
  const modelsDir = getModelsDirectory();
  const modelPaths = filenames.map((f) => path.join(modelsDir, f));
  try {
    const results = await scheduler.preloadModels(modelPaths);
    return { success: true, results: results.map((r) => ({ status: r.status, reason: r.reason })) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:update-config', async (event, partial) => {
  if (!scheduler) return { success: false, error: 'Scheduler not initialized' };
  try {
    await scheduler.updateConfig(partial);
    return { success: true, config: scheduler.config };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:get-config', () => {
  if (!scheduler) return null;
  return scheduler.config;
});

ipcMain.handle('scheduler:terminate-runner', async (event, modelPath) => {
  if (!scheduler) return { success: false, error: 'Scheduler not initialized' };
  try {
    await scheduler.terminateRunner(modelPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// ============================================================================
// Knowledge Base IPC handlers
// ============================================================================

ipcMain.handle('kb:get-collections', async () => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const collections = await global.knowledgeBase.getCollections();
    return { success: true, collections };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:create-collection', async (event, name, description) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const collection = await global.knowledgeBase.createCollection(name, description);
    return { success: true, collection };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:delete-collection', async (event, id) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    await global.knowledgeBase.deleteCollection(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:ingest-documents', async (event, collectionId, fileEntries, options) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const result = await global.knowledgeBase.ingestDocuments(collectionId, fileEntries, options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:ingest-url', async (event, collectionId, url, options) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const result = await global.knowledgeBase.ingestUrl(collectionId, url, options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:search', async (event, collectionId, query, topK) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const results = await global.knowledgeBase.search(collectionId, query, topK);
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:get-documents', async (event, collectionId) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    const documents = await global.knowledgeBase.getDocuments(collectionId);
    return { success: true, documents };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:delete-document', async (event, collectionId, docId) => {
  try {
    if (!global.knowledgeBase) return { success: false, error: 'Knowledge Base not initialized' };
    await global.knowledgeBase.deleteDocument(collectionId, docId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('kb:get-mcp-config', () => {
  return {
    success: true,
    config: {
      command: process.platform === 'win32' ? 'node' : 'node',
      args: [path.join(__dirname, 'knowledge-base-mcp-launcher.js')],
      env: { KB_DB_PATH: global.knowledgeBase ? global.knowledgeBase.dbPath : '' }
    }
  };
});

// ============================================================================
// Workspace IPC handlers
// ============================================================================

ipcMain.handle('workspace:get-state', () => {
  try {
    if (!global.workspaceManager) return { success: false, error: 'Workspace Manager not initialized' };
    return { success: true, state: global.workspaceManager.getState() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workspace:set-folder', async (event, folderPath) => {
  try {
    if (!global.workspaceManager) return { success: false, error: 'Workspace Manager not initialized' };
    const result = global.workspaceManager.setFolder(folderPath);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workspace:open-sandbox', () => {
  try {
    if (!global.workspaceManager) return { success: false, error: 'Workspace Manager not initialized' };
    const result = global.workspaceManager.openSandbox();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workspace:get-file-tree', (event, folderPath, depth) => {
  try {
    if (!global.workspaceManager) return { success: false, error: 'Workspace Manager not initialized' };
    const tree = global.workspaceManager.getFileTree(folderPath, depth);
    return { success: true, tree };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// TUI (Terminal UI) IPC handlers
// Allows the webui to launch the TUI and configure its workspace folder.
// The TUI workspace is stored separately in electron-store as
// `tui.workspaceFolder` so it can differ from the main workspace if desired,
// but defaults to the main workspace folder when not set.
// ============================================================================

ipcMain.handle('tui:launch', async (event, opts) => {
  try {
    // Determine workspace folder: explicit opts > TUI-specific setting > main workspace
    let workspace = (opts && opts.workspace) || store.get('tui.workspaceFolder', null);
    if (!workspace && global.workspaceManager) {
      workspace = global.workspaceManager.getState().activeFolder;
    }
    const controlUrl = (opts && opts.controlUrl) || 'http://127.0.0.1:13439';
    const model = (opts && opts.model) || 'bonsai-27b';
    const result = await launchTui({ workspace: workspace || undefined, controlUrl, model });
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('tui:get-workspace', () => {
  try {
    const tuiWorkspace = store.get('tui.workspaceFolder', null);
    const mainWorkspace = global.workspaceManager
      ? global.workspaceManager.getState().activeFolder
      : null;
    return {
      success: true,
      tuiWorkspace,
      mainWorkspace,
      effective: tuiWorkspace || mainWorkspace,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('tui:set-workspace', async (event, folderPath) => {
  try {
    store.set('tui.workspaceFolder', folderPath || null);
    console.log(`[tui] Workspace folder set to: ${folderPath || '(cleared)'}`);
    return { success: true, tuiWorkspace: folderPath || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('tui:find-binary', () => {
  try {
    const binaryPath = findTuiBinary();
    return { success: true, found: !!binaryPath, binaryPath };
  } catch (err) {
    return { success: false, error: err.message, found: false };
  }
});

// ============================================================================
// VRAM / Memory IPC handlers
// ============================================================================

ipcMain.handle('get-active-allocations-mb', () => {
  try {
    if (!scheduler) return [];
    return scheduler.getActiveAllocationsMB();
  } catch (error) {
    console.error('[get-active-allocations-mb] Error:', error.message);
    return [];
  }
});

ipcMain.handle('detect-vram-budget', async () => {
  try {
    const vramBudgetManager = require('./vram-budget-manager');
    if (!vramBudgetManager || typeof vramBudgetManager.detect !== 'function') {
      return { detected: false };
    }
    return await vramBudgetManager.detect();
  } catch (error) {
    console.error('[detect-vram-budget] Error:', error.message);
    return { detected: false };
  }
});

ipcMain.handle('auto-tune-ngl', async (event, params) => {
  try {
    const { autoTuneNgl } = require('./ngl-optimizer');
    const { modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB } = params;
    const result = autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB || []);
    return result;
  } catch (error) {
    console.error('[auto-tune-ngl] Error:', error.message);
    throw error;
  }
});


// ============================================================================
// IDE Config Generator IPC handlers
// ============================================================================

ipcMain.handle('ide:generate-configs', async (event, ideId, modelName) => {
  try {
    const outputDir = path.join(app.getPath('userData'), 'ide-configs', ideId || 'all');
    const generator = new IdeConfigGenerator({ app, logger: console });
    let result;
    switch (ideId) {
      case 'vscode-continue':
        result = generator.writeVsCodeContinueConfig(outputDir, modelName);
        break;
      case 'cursor':
        result = generator.writeCursorConfig(outputDir);
        break;
      case 'jetbrains':
        result = generator.writeJetBrainsConfig(outputDir);
        break;
      case 'mcp':
        result = generator.writeMcpConfig(outputDir);
        break;
      default:
        result = generator.generateAllConfigs(outputDir, modelName);
    }
    return { success: true, paths: Array.isArray(result) ? result : [result], outputDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ide:list-supported', () => {
  const generator = new IdeConfigGenerator();
  return { success: true, ides: generator.getSupportedIdes() };
});

ipcMain.handle('ide:open-config-folder', async () => {
  const outputDir = path.join(app.getPath('userData'), 'ide-configs');
  shell.openPath(outputDir);
  return { success: true, path: outputDir };
});


// ============================================================================
// Launch Service IPC handlers
// ============================================================================

ipcMain.handle('launch:list-integrations', () => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    return { success: true, integrations: global.launchService.getIntegrations() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch:configure', async (event, integrationId, model) => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    const result = await global.launchService.launch(integrationId, model);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch:generate-env', async (event, integrationId, model) => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    const outputDir = path.join(app.getPath('userData'), 'launch-envs');
    const filePath = global.launchService.writeEnvFile(integrationId, model, outputDir);
    return { success: true, filePath, integrationId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch:open-env-folder', async () => {
  const outputDir = path.join(app.getPath('userData'), 'launch-envs');
  shell.openPath(outputDir);
  return { success: true, path: outputDir };
});

ipcMain.handle('launch:check-installed', async (event, integrationId) => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    const status = global.launchService.checkIfInstalled(integrationId);
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch:check-all-installed', async () => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    const statuses = global.launchService.checkAllInstalled();
    return { success: true, statuses };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('launch:launch-integration', async (event, integrationId, model) => {
  try {
    if (!global.launchService) return { success: false, error: 'Launch Service not initialized' };
    const result = global.launchService.launchIntegration(integrationId, model);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
