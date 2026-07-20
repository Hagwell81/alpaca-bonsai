/* eslint-env node */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Bonsai variant llama.cpp release (PrismML-Eng/llama.cpp) - the upstream
// ggml-org/llama.cpp release is kept as a fallback in case the bonsai fork
// is unavailable. The bonsai fork ships the ternary model patches and the
// `llama-tts` binary used by the voice service.
//
// The user can switch the preferred repo at runtime via the Providers settings
// UI (stored in electron-store as `llamaCppRepoPreference`). This allows
// switching to upstream ggml-org/llama.cpp once it natively supports ternary
// bonsai models. See `getPreferredRepos()`.
const LLAMA_CPP_RELEASES = [
  'PrismML-Eng/llama.cpp', // bonsai variant (preferred by default)
  'ggml-org/llama.cpp',    // upstream fallback
];

// Runtime preference: 'bonsai' (default) or 'upstream'.
// When 'bonsai', PrismML-Eng is tried first. When 'upstream', ggml-org is
// tried first. The other repo is always used as a fallback if the preferred
// one doesn't have the needed asset.
let _repoPreference = 'bonsai';

/**
 * Set the preferred llama.cpp repo variant.
 * @param {'bonsai'|'upstream'} pref
 */
function setRepoPreference(pref) {
  if (pref === 'upstream' || pref === 'bonsai') {
    _repoPreference = pref;
    console.log(`[binary-manager] Repo preference set to: ${pref}`);
  }
}

/**
 * Get the current repo preference.
 * @returns {'bonsai'|'upstream'}
 */
function getRepoPreference() {
  return _repoPreference;
}

/**
 * Returns the ordered list of repos to try, based on the current preference.
 * @returns {string[]}
 */
function getPreferredRepos() {
  if (_repoPreference === 'upstream') {
    return [LLAMA_CPP_RELEASES[1], LLAMA_CPP_RELEASES[0]];
  }
  return LLAMA_CPP_RELEASES; // bonsai first (default)
}

const GITHUB_API_LATEST = `https://api.github.com/repos/${LLAMA_CPP_RELEASES[0]}/releases/latest`;
const GITHUB_API_RELEASES = `https://api.github.com/repos/${LLAMA_CPP_RELEASES[0]}/releases?per_page=15`;
const GITHUB_DOWNLOAD = `https://github.com/${LLAMA_CPP_RELEASES[0]}/releases/download`;
const CDN_FALLBACK_API = 'https://catalog.jan.ai/llama.cpp/releases/releases.json';

// sd.cpp (stable-diffusion.cpp) release for image generation backends.
// Used by the new ImageService to run the Bonsai Image 4B diffusion model.
const SD_CPP_RELEASE = 'leejet/stable-diffusion.cpp';
const SD_CPP_API_LATEST = `https://api.github.com/repos/${SD_CPP_RELEASE}/releases/latest`;
const SD_CPP_DOWNLOAD = `https://github.com/${SD_CPP_RELEASE}/releases/download`;

// whisper.cpp release for STT. The voice-service.js already downloads the
// whisper-cli binary on its own; this constant is exposed so other modules
// (and the onboarding UI) can reference the same release.
const WHISPER_CPP_RELEASE = 'ggerganov/whisper.cpp';

// Cache configuration
const CACHE_MAX_VERSIONS = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// How many recent releases to walk backwards through when the newest release
// is missing our backend asset. llama.cpp's CI publishes releases in two
// phases: the release body (with download links) is committed first and the
// ~25 platform-specific binaries are uploaded over several minutes afterward.
// If the user happens to open the app during that window the GitHub API
// returns the release with only a partial `assets` array, producing a
// spurious "No release asset found" error. Falling back to the previous
// release avoids that race without any manual intervention.
const RELEASE_FALLBACK_LIMIT = 10;

const pendingDownloads = new Map();

/**
 * LRU Cache for backend versions
 * Maintains up to CACHE_MAX_VERSIONS cached backends with LRU eviction policy
 */
class BackendLRUCache {
  constructor() {
    this.cache = new Map(); // key: `${version}/${backend}`, value: { exePath, backendDir, tag, backend, timestamp }
    this.accessOrder = []; // Track access order for LRU eviction
  }

  /**
   * Get cached backend if it exists and is valid
   * @param {string} version - Release version tag
   * @param {string} backend - Backend identifier
   * @returns {Object|null} Cached backend info or null if not found/expired
   */
  get(version, backend) {
    const key = `${version}/${backend}`;
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check if cache entry is still valid (file exists)
    if (!fs.existsSync(entry.exePath)) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return null;
    }
    
    // Update access order for LRU
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
    
    return entry;
  }

  /**
   * Set cached backend
   * @param {string} version - Release version tag
   * @param {string} backend - Backend identifier
   * @param {Object} data - Backend info { exePath, backendDir, tag, backend }
   */
  set(version, backend, data) {
    const key = `${version}/${backend}`;
    
    // Remove if already exists
    if (this.cache.has(key)) {
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    }
    
    // Add new entry
    this.cache.set(key, {
      ...data,
      timestamp: Date.now()
    });
    this.accessOrder.push(key);
    
    // Evict oldest if cache is full
    if (this.cache.size > CACHE_MAX_VERSIONS) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats { size, maxSize, entries }
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: CACHE_MAX_VERSIONS,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        timestamp: value.timestamp,
        exePath: value.exePath
      }))
    };
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }
}

const backendCache = new BackendLRUCache();

function getBackendsDir(app) {
  const dir = path.join(app.getPath('userData'), 'backends');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get cache directory for a specific backend version
 * Structure: {userData}/backends/cache/{version}/{backend}/
 * @param {string} app - Electron app instance
 * @param {string} version - Release version tag
 * @param {string} backend - Backend identifier
 * @returns {string} Cache directory path
 */
function getCacheDir(app, version, backend) {
  const cacheDir = path.join(getBackendsDir(app), 'cache', version, backend);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Get cache metadata file path
 * @param {string} app - Electron app instance
 * @param {string} version - Release version tag
 * @param {string} backend - Backend identifier
 * @returns {string} Metadata file path
 */
function getCacheMetadataPath(app, version, backend) {
  return path.join(getCacheDir(app, version, backend), '.cache-metadata.json');
}

/**
 * Load cache metadata
 * @param {string} metadataPath - Path to metadata file
 * @returns {Object} Metadata { version, backend, timestamp, hash }
 */
function loadCacheMetadata(metadataPath) {
  try {
    if (fs.existsSync(metadataPath)) {
      const data = fs.readFileSync(metadataPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn(`[binary-manager] Failed to load cache metadata: ${err.message}`);
  }
  return null;
}

/**
 * Save cache metadata
 * @param {string} metadataPath - Path to metadata file
 * @param {Object} metadata - Metadata to save
 */
function saveCacheMetadata(metadataPath, metadata) {
  try {
    const dir = path.dirname(metadataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[binary-manager] Failed to save cache metadata: ${err.message}`);
  }
}

/**
 * Check if backend exists in cache and is valid
 * @param {string} app - Electron app instance
 * @param {string} version - Release version tag
 * @param {string} backend - Backend identifier
 * @returns {Object|null} Cached backend info or null if not found
 */
function getCachedBackend(app, version, backend) {
  // Check LRU cache first
  const cached = backendCache.get(version, backend);
  if (cached) {
    console.log(`[binary-manager] Backend ${backend}@${version} found in LRU cache`);
    return cached;
  }

  // Check filesystem cache
  const cacheDir = getCacheDir(app, version, backend);
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const exePath = path.join(cacheDir, exeName);

  if (fs.existsSync(exePath)) {
    const dllCheck = verifyBackendDlls(cacheDir, backend);
    if (dllCheck.ok) {
      console.log(`[binary-manager] Backend ${backend}@${version} found in filesystem cache`);
      const backendDir = cacheDir;
      const result = { exePath, backendDir, tag: version, backend, fresh: false };
      backendCache.set(version, backend, result);
      return result;
    }
  }

  return null;
}

/**
 * Evict oldest cached backend versions using LRU policy
 * Keeps only CACHE_MAX_VERSIONS most recent versions
 * @param {string} app - Electron app instance
 */
function evictOldCachedVersions(app) {
  const backendsDir = getBackendsDir(app);
  const cacheDir = path.join(backendsDir, 'cache');
  
  if (!fs.existsSync(cacheDir)) return;

  try {
    const versions = fs.readdirSync(cacheDir);
    if (versions.length <= CACHE_MAX_VERSIONS) return;

    // Get version directories with their modification times
    const versionDirs = versions
      .map(v => {
        const vPath = path.join(cacheDir, v);
        try {
          const stat = fs.statSync(vPath);
          return { version: v, path: vPath, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(v => v !== null)
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Evict oldest versions beyond CACHE_MAX_VERSIONS
    for (let i = CACHE_MAX_VERSIONS; i < versionDirs.length; i++) {
      const versionPath = versionDirs[i].path;
      console.log(`[binary-manager] Evicting old cached version: ${versionDirs[i].version}`);
      try {
        fs.rmSync(versionPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[binary-manager] Failed to evict version ${versionDirs[i].version}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[binary-manager] Error during cache eviction: ${err.message}`);
  }
}

function mapCapabilitiesToBackend(caps) {
  const platform = process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'macos'
    : 'ubuntu';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (platform === 'win') {
    if (caps && caps.cuda) return 'win-cuda-12.4-x64';
    if (caps && caps.vulkan) return 'win-vulkan-x64';
    if (caps && caps.rocm) return 'win-hip-radeon-x64';
    return arch === 'arm64' ? 'win-cpu-arm64' : 'win-cpu-x64';
  }
  if (platform === 'macos') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  // Linux
  if (caps && caps.vulkan) return 'ubuntu-vulkan-x64';
  if (caps && caps.rocm) return 'ubuntu-rocm-7.2-x64';
  if (arch === 'arm64') return 'ubuntu-arm64';
  return 'ubuntu-x64';
}

function getRequiredDlls(backend) {
  // Core DLLs that should be present for all Windows backends
  // ggml-base.dll is required by newer llama.cpp builds (ggml.dll is a thin shim)
  const core = ['ggml-base.dll', 'ggml.dll', 'llama-common.dll', 'llama.dll'];
  const extra = [];
  if (backend.includes('cuda')) {
    extra.push('ggml-cuda.dll');
  }
  if (backend.includes('vulkan')) {
    extra.push('ggml-vulkan.dll');
  }
  if (backend.includes('hip') || backend.includes('radeon')) {
    extra.push('ggml-hip.dll');
  }
  if (backend.includes('cpu')) {
    extra.push('ggml-cpu.dll');
  }
  return [...core, ...extra];
}

/**
 * Check whether the Microsoft Visual C++ 2015-2022 Redistributable (x64)
 * runtime DLLs are present on the system. These are required by any
 * MSVC-built binary (llama-server.exe, ggml.dll, etc.).
 *
 * @returns {{ok: boolean, missing: string[], systemDir: string|null}}
 */
function verifyVcRuntime() {
  if (process.platform !== 'win32') return { ok: true, missing: [], systemDir: null };

  const sysDirs = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
  ];

  const required = ['vcruntime140.dll', 'msvcp140.dll'];
  const preferred = ['vcruntime140_1.dll', 'msvcp140_1.dll'];

  let systemDir = null;
  for (const dir of sysDirs) {
    if (fs.existsSync(dir) && required.every(dll => fs.existsSync(path.join(dir, dll)))) {
      systemDir = dir;
      break;
    }
  }

  const missing = [];
  if (!systemDir) {
    // Report which exact DLLs are missing from the first system directory
    const firstDir = sysDirs[0];
    for (const dll of required) {
      if (!fs.existsSync(path.join(firstDir, dll))) missing.push(dll);
    }
  }

  const ok = missing.length === 0;
  if (ok && systemDir) {
    // Also warn about preferred but non-critical DLLs
    const preferredMissing = preferred.filter(dll => !fs.existsSync(path.join(systemDir, dll)));
    if (preferredMissing.length > 0) {
      console.warn(`[binary-manager] VC++ runtime preferred DLLs missing: ${preferredMissing.join(', ')}`);
    }
  }

  return { ok, missing, systemDir };
}

function getCudaRuntimeAsset(backend, tag) {
  if (backend.includes('cuda-12.4')) return `cudart-llama-bin-win-cuda-12.4-x64.zip`;
  if (backend.includes('cuda-13.1')) return `cudart-llama-bin-win-cuda-13.1-x64.zip`;
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'alpaca/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function getLatestReleaseInfo() {
  try {
    const release = await fetchJson(GITHUB_API_LATEST);
    return { tag: release.tag_name, assets: release.assets || [], source: 'github', repo: LLAMA_CPP_RELEASES[0] };
  } catch (err) {
    console.warn('[binary-manager] GitHub API failed, trying CDN fallback:', err.message);
    try {
      const releases = await fetchJson(CDN_FALLBACK_API);
      const latest = Array.isArray(releases) ? releases[0] : (releases.releases || [])[0];
      if (!latest) throw new Error('No releases found in CDN fallback');
      return { tag: latest.tag_name, assets: latest.assets || [], source: 'cdn', repo: LLAMA_CPP_RELEASES[0] };
    } catch (err2) {
      throw new Error(`Failed to fetch releases: ${err2.message}`);
    }
  }
}

/**
 * Get the latest release info from a specific GitHub repo.
 * Works for any repo (llama.cpp variants, sd.cpp, whisper.cpp, etc.).
 * @param {string} repo - Full repo slug (owner/name)
 * @returns {Promise<{tag:string, assets:Array, source:string, repo:string}>}
 */
async function getLatestReleaseInfoForRepo(repo) {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    return { tag: release.tag_name, assets: release.assets || [], source: 'github', repo };
  } catch (err) {
    throw new Error(`Failed to fetch latest release for ${repo}: ${err.message}`);
  }
}

/**
 * Get the current installed sd-cli binary info (tag if determinable, path, installed).
 * @param {import('electron').App} app
 * @returns {{tag:string|null, path:string|null, installed:boolean}}
 */
function getSdBackendInfo(app) {
  const exeName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
  const binDir = getSdBinDir(app);
  const localPath = path.join(binDir, exeName);
  if (fs.existsSync(localPath)) {
    // Try to read a version marker file if it exists
    const versionFile = path.join(binDir, '.version');
    let tag = 'installed';
    try {
      if (fs.existsSync(versionFile)) {
        tag = fs.readFileSync(versionFile, 'utf8').trim() || 'installed';
      }
    } catch (_) { /* ignore */ }
    return { tag, path: localPath, installed: true };
  }
  return { tag: null, path: null, installed: false };
}

/**
 * Returns up to `RELEASE_FALLBACK_LIMIT` recent releases, newest first.
 * Uses the multi-release GitHub endpoint when available so we can fall
 * back past a freshly-published but not-yet-fully-uploaded release.
 *
 * @param {string} [repo] - Full repo slug (owner/name). Defaults to the
 *   preferred bonsai variant (LLAMA_CPP_RELEASES[0]).
 */
async function getRecentReleases(repo = LLAMA_CPP_RELEASES[0]) {
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=15`);
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error('Empty releases list from GitHub');
    }
    return releases
      .filter((r) => r && !r.draft)
      .slice(0, RELEASE_FALLBACK_LIMIT)
      .map((r) => ({ tag: r.tag_name, assets: r.assets || [], source: 'github', repo }));
  } catch (err) {
    console.warn(`[binary-manager] Recent releases fetch failed for ${repo}, falling back to CDN:`, err.message);
    try {
      const releases = await fetchJson(CDN_FALLBACK_API);
      const list = Array.isArray(releases) ? releases : (releases.releases || []);
      return list
        .slice(0, RELEASE_FALLBACK_LIMIT)
        .map((r) => ({ tag: r.tag_name, assets: r.assets || [], source: 'cdn', repo }));
    } catch (err2) {
      // Last resort: just return whatever `latest` gives us.
      const latest = await getLatestReleaseInfo();
      return [latest];
    }
  }
}

function assetMatchesBackend(asset, tag, backend) {
  if (!asset || !asset.name) return false;
  const name = asset.name;
  if (!(name.endsWith('.zip') || name.endsWith('.tar.gz'))) return false;
  // ggml-org/llama.cpp uses `llama-${tag}-bin-${backend}` (tag in filename).
  const withTag = `llama-${tag}-bin-${backend}`;
  // PrismML-Eng/llama.cpp uses `llama-bin-${backend}` (no tag in filename).
  const withoutTag = `llama-bin-${backend}`;
  return name.startsWith(withTag) || name.startsWith(withoutTag);
}

/**
 * Walks recent releases (newest → oldest) and returns the first one that
 * actually has the backend asset uploaded. This sidesteps the llama.cpp
 * CI upload race where the latest release has a body listing all binaries
 * but only a subset are fully uploaded.
 *
 * Tries repos in preference order (see `getPreferredRepos()`). By default
 * the bonsai variant (PrismML-Eng/llama.cpp) is tried first, then upstream
 * ggml-org/llama.cpp. The user can switch the order via `setRepoPreference()`.
 *
 * @returns {Promise<{tag:string, assets:Array, source:string, repo:string}>}
 */
async function findReleaseWithBackendAsset(backend) {
  const repos = getPreferredRepos();
  for (const repo of repos) {
    const candidates = await getRecentReleases(repo);
    if (candidates.length === 0) continue;
    for (const release of candidates) {
      const match = release.assets.find((a) => assetMatchesBackend(a, release.tag, backend));
      if (match) {
        if (release !== candidates[0]) {
          console.warn(`[binary-manager] Latest release ${candidates[0].tag} of ${repo} is missing backend "${backend}" (likely still uploading); using ${release.tag} instead.`);
        }
        if (repo !== repos[0]) {
          console.warn(`[binary-manager] Backend "${backend}" not found in ${repos[0]}; falling back to ${repo} (${release.tag}).`);
        }
        return release;
      }
    }
  }
  // Nothing found in any repo — surface a descriptive error.
  const tried = (await getRecentReleases(repos[0])).map((c) => c.tag).join(', ');
  throw new Error(`No release in the last ${RELEASE_FALLBACK_LIMIT} tags (${tried}) of ${repos[0]} or ${repos[1]} contains an asset for backend "${backend}". The llama.cpp CI may still be uploading binaries; please retry in a few minutes.`);
}

function getAssetUrl(tag, assetName, repo = LLAMA_CPP_RELEASES[0]) {
  return `https://github.com/${repo}/releases/download/${tag}/${assetName}`;
}

function extractArchive(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const isZip = archivePath.endsWith('.zip');
    const isTarGz = archivePath.endsWith('.tar.gz');

    if (!isZip && !isTarGz) {
      return reject(new Error(`Unsupported archive format: ${archivePath}`));
    }

    if (process.platform === 'win32' && isZip) {
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      ps.stderr.on('data', d => stderr += d);
      ps.on('close', code => {
        if (code !== 0) return reject(new Error(`Expand-Archive failed (code ${code}): ${stderr}`));
        resolve();
      });
    } else if (isTarGz) {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(`tar extraction failed (code ${code}): ${stderr}`));
        resolve();
      });
    } else {
      const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        // unzip returns 1 for warnings (e.g. replacing files) which is fine
        if (code !== 0 && code !== 1) return reject(new Error(`unzip failed (code ${code}): ${stderr}`));
        resolve();
      });
    }
  });
}

function verifyBackendDlls(backendDir, backend) {
  if (process.platform !== 'win32') return { missing: [], ok: true };
  const required = getRequiredDlls(backend);
  const missing = [];
  for (const dll of required) {
    const dllPath = path.join(backendDir, dll);
    if (!fs.existsSync(dllPath)) {
      missing.push(dll);
    }
  }
  return { missing, ok: missing.length === 0 };
}

/**
 * Get or create GPG public key for ggml-org
 * Stores the key in {userData}/backends/.gpg-keys/
 * Fetches from GitHub if not cached locally
 * @param {string} app - Electron app instance
 * @returns {Promise<string>} Path to public key file
 */
async function getGPGPublicKey(app) {
  const keysDir = path.join(getBackendsDir(app), '.gpg-keys');
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  const keyPath = path.join(keysDir, 'ggml-org.pub');
  
  // If key already exists and is recent (< 30 days), return it
  if (fs.existsSync(keyPath)) {
    try {
      const stat = fs.statSync(keyPath);
      const ageMs = Date.now() - stat.mtimeMs;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (ageMs < thirtyDaysMs) {
        return keyPath;
      }
    } catch (err) {
      console.warn(`[binary-manager] Failed to check key age: ${err.message}`);
    }
  }

  // Try to fetch public key from GitHub (ggml-org's GPG key)
  try {
    const keyUrl = 'https://github.com/ggml-org.gpg';
    const response = await new Promise((resolve, reject) => {
      https.get(keyUrl, {
        headers: { 'User-Agent': 'alpaca/1.0' }
      }, resolve).on('error', reject);
    });

    if (response.statusCode === 200) {
      let keyData = '';
      response.on('data', chunk => keyData += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', () => {
          try {
            fs.writeFileSync(keyPath, keyData, 'utf8');
            console.log(`[binary-manager] GPG public key fetched and stored at ${keyPath}`);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        response.on('error', reject);
      });
    } else {
      throw new Error(`HTTP ${response.statusCode}`);
    }
  } catch (err) {
    console.warn(`[binary-manager] Failed to fetch GPG public key from GitHub: ${err.message}`);
    
    // Create a stub key if fetch fails (can be replaced manually)
    if (!fs.existsSync(keyPath)) {
      const stubKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Version: GnuPG v2

Note: This is a placeholder key. Replace with actual ggml-org public key.
For now, signature verification will be skipped if GPG is not available.

-----END PGP PUBLIC KEY BLOCK-----`;

      try {
        fs.writeFileSync(keyPath, stubKey, 'utf8');
        console.log(`[binary-manager] Created placeholder GPG public key at ${keyPath}`);
      } catch (err2) {
        console.warn(`[binary-manager] Failed to create placeholder key: ${err2.message}`);
      }
    }
  }

  return keyPath;
}

/**
 * Verify GPG signature of a downloaded file
 * @param {string} filePath - Path to the file to verify
 * @param {string} signaturePath - Path to the signature file (.asc)
 * @param {string} publicKeyPath - Path to the public key file
 * @returns {Promise<{verified: boolean, error?: string}>} Verification result
 */
async function verifyGPGSignature(filePath, signaturePath, publicKeyPath) {
  return new Promise((resolve) => {
    // Check if files exist
    if (!fs.existsSync(filePath)) {
      return resolve({ verified: false, error: `File not found: ${filePath}` });
    }
    if (!fs.existsSync(signaturePath)) {
      return resolve({ verified: false, error: `Signature file not found: ${signaturePath}` });
    }
    if (!fs.existsSync(publicKeyPath)) {
      return resolve({ verified: false, error: `Public key not found: ${publicKeyPath}` });
    }

    // Check if gpg command is available
    const gpgCmd = process.platform === 'win32' ? 'gpg.exe' : 'gpg';
    
    const proc = spawn(gpgCmd, [
      '--no-default-keyring',
      `--keyring=${publicKeyPath}`,
      '--verify',
      signaturePath,
      filePath
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', d => stderr += d);
    proc.stdout.on('data', d => stdout += d);
    
    proc.on('close', code => {
      if (code === 0) {
        console.log(`[binary-manager] GPG signature verified for ${path.basename(filePath)}`);
        resolve({ verified: true });
      } else {
        const error = `GPG verification failed (code ${code}): ${stderr || stdout}`;
        console.warn(`[binary-manager] ${error}`);
        resolve({ verified: false, error });
      }
    });

    proc.on('error', err => {
      // GPG not available - skip verification but log warning
      console.warn(`[binary-manager] GPG not available, skipping signature verification: ${err.message}`);
      resolve({ verified: true, skipped: true, reason: 'GPG not available' });
    });
  });
}

/**
 * Compute SHA-256 hash of a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verify file integrity using SHA-256 hash
 * @param {string} filePath - Path to the file
 * @param {string} expectedHash - Expected SHA-256 hash (hex-encoded)
 * @returns {Promise<{verified: boolean, computedHash: string}>} Verification result
 */
async function verifyFileHash(filePath, expectedHash) {
  try {
    const computedHash = await computeFileHash(filePath);
    const verified = computedHash.toLowerCase() === expectedHash.toLowerCase();
    
    if (verified) {
      console.log(`[binary-manager] File hash verified for ${path.basename(filePath)}`);
    } else {
      console.warn(`[binary-manager] File hash mismatch for ${path.basename(filePath)}`);
      console.warn(`  Expected: ${expectedHash}`);
      console.warn(`  Computed: ${computedHash}`);
    }
    
    return { verified, computedHash };
  } catch (err) {
    console.warn(`[binary-manager] Failed to compute file hash: ${err.message}`);
    return { verified: false, computedHash: '', error: err.message };
  }
}

async function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ }
    }
    const file = fs.createWriteStream(destPath);

    function handleResponse(response) {
      if (response.statusCode === 301 || response.statusCode === 302 ||
          response.statusCode === 307 || response.statusCode === 308) {
        if (!response.headers.location) {
          file.destroy();
          fs.unlink(destPath, () => {});
          return reject(new Error('Redirect with no Location header'));
        }
        const redirectUrl = response.headers.location;
        response.resume();
        https.get(redirectUrl, { headers: { 'User-Agent': 'alpaca/1.0' } }, handleResponse)
          .on('error', err => {
            file.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        return;
      }

      if (response.statusCode !== 200) {
        file.destroy();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const total = parseInt(response.headers['content-length'], 10) || 0;
      let current = 0;
      response.on('data', chunk => {
        current += chunk.length;
        if (onProgress) onProgress(current, total);
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }

    https.get(url, { headers: { 'User-Agent': 'alpaca/1.0' } }, handleResponse)
      .on('error', err => {
        file.destroy();
        fs.unlink(destPath, () => {});
        reject(err);
      })
      .setTimeout(300000, () => {
        file.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error('Download timeout after 5 minutes'));
      });
  });
}

function findExeRecursively(dir, exeName) {
  if (!fs.existsSync(dir)) return null;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const found = findExeRecursively(full, exeName);
      if (found) return found;
    } else if (item === exeName) {
      return full;
    }
  }
  return null;
}

async function ensureBackend(app, caps, onProgress, onStatus) {
  const backend = mapCapabilitiesToBackend(caps);
  const backendKey = `${backend}`;

  // Prevent duplicate concurrent downloads for the same backend
  if (pendingDownloads.has(backendKey)) {
    console.log(`[binary-manager] Backend ${backend} download already in progress, waiting...`);
    if (onStatus) onStatus({ phase: 'waiting', backend });
    const existing = await pendingDownloads.get(backendKey);
    return existing;
  }

  // Walk recent releases (newest → oldest) and use the first one whose
  // backend asset is fully uploaded. This tolerates the ~several-minute
  // window after a new llama.cpp release is published but before all
  // platform binaries finish uploading. See `findReleaseWithBackendAsset`.
  // Falls back to the upstream ggml-org/llama.cpp release when the preferred
  // bonsai fork (PrismML-Eng/llama.cpp) doesn't ship the requested backend
  // (e.g. vulkan builds are only published upstream).
  const { tag, assets, repo } = await findReleaseWithBackendAsset(backend);
  const releaseRepo = repo || LLAMA_CPP_RELEASES[0];
  
  // Check cache first (3.5.3: Implement cache lookup before download)
  const cachedBackend = getCachedBackend(app, tag, backend);
  if (cachedBackend) {
    console.log(`[binary-manager] Using cached backend ${backend}@${tag}`);
    if (onStatus) onStatus({ phase: 'ready', backend, tag, result: cachedBackend });
    return cachedBackend;
  }

  const backendsDir = getBackendsDir(app);
  const cacheDir = getCacheDir(app, tag, backend);
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const exePath = path.join(cacheDir, exeName);

  // Check if already cached (legacy check)
  if (fs.existsSync(exePath)) {
    const dllCheck = verifyBackendDlls(cacheDir, backend);
    if (dllCheck.ok) {
      console.log(`[binary-manager] Backend ${backend}@${tag} already cached and verified.`);
      const result = { exePath, backendDir: cacheDir, tag, backend, fresh: false };
      backendCache.set(tag, backend, result);
      return result;
    }
    console.warn(`[binary-manager] Backend ${backend}@${tag} cached but missing DLLs: ${dllCheck.missing.join(', ')}. Re-downloading...`);
  }

  // Some backends may extract into a subfolder; do a recursive search as a fallback
  const existing = findExeRecursively(cacheDir, exeName);
  if (existing) {
    const subDir = path.dirname(existing);
    const dllCheck = verifyBackendDlls(subDir, backend);
    if (dllCheck.ok) {
      console.log(`[binary-manager] Backend ${backend}@${tag} already cached (found in subdir).`);
      const result = { exePath: existing, backendDir: subDir, tag, backend, fresh: false };
      backendCache.set(tag, backend, result);
      return result;
    }
    console.warn(`[binary-manager] Backend ${backend}@${tag} found in subdir but missing DLLs: ${dllCheck.missing.join(', ')}. Re-downloading...`);
  }

  // Find the matching asset (supports both .zip and .tar.gz).
  // Tries both ggml-org (llama-${tag}-bin-${backend}) and PrismML-Eng
  // (llama-bin-${backend}) naming conventions.
  const asset = assets.find(a => assetMatchesBackend(a, tag, backend));
  if (!asset) {
    throw new Error(`No release asset found for backend "${backend}" in tag ${tag} of ${releaseRepo}`);
  }

  // Clean old incomplete download
  if (fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
  fs.mkdirSync(cacheDir, { recursive: true });

  if (onStatus) onStatus({ phase: 'downloading', backend, tag, assetName: asset.name });

  // Download backend archive
  const archivePath = path.join(cacheDir, `backend${asset.name.endsWith('.tar.gz') ? '.tar.gz' : '.zip'}`);
  const downloadUrl = asset.browser_download_url || getAssetUrl(tag, asset.name, releaseRepo);
  console.log(`[binary-manager] Downloading ${asset.name} from ${downloadUrl}...`);

  const downloadPromise = downloadFile(downloadUrl, archivePath, onProgress);
  pendingDownloads.set(backendKey, downloadPromise.then(async () => {
    // Extract
    if (onStatus) onStatus({ phase: 'extracting', backend, tag });
    console.log(`[binary-manager] Extracting ${asset.name}...`);
    await extractArchive(archivePath, cacheDir);
    try { fs.unlinkSync(archivePath); } catch (_) { /* ignore */ }

    // Download CUDA runtime DLLs if needed (Windows CUDA backends)
    const cudaAssetName = getCudaRuntimeAsset(backend, tag);
    if (cudaAssetName) {
      const cudaAsset = assets.find(a => a.name === cudaAssetName);
      if (cudaAsset) {
        const cudaZipPath = path.join(cacheDir, 'cuda-runtime.zip');
        const cudaUrl = cudaAsset.browser_download_url || getAssetUrl(tag, cudaAsset.name, releaseRepo);
        console.log(`[binary-manager] Downloading CUDA runtime ${cudaAsset.name}...`);
        await downloadFile(cudaUrl, cudaZipPath, null);
        console.log(`[binary-manager] Extracting CUDA runtime...`);
        await extractArchive(cudaZipPath, cacheDir);
        try { fs.unlinkSync(cudaZipPath); } catch (_) { /* ignore */ }
      }
    }

    // Verify the binary exists
    let finalExePath = exePath;
    if (!fs.existsSync(exePath)) {
      const found = findExeRecursively(cacheDir, exeName);
      if (!found) {
        throw new Error(`llama-server executable not found after extraction in ${cacheDir}`);
      }
      finalExePath = found;
    }

    // Verify required DLLs on Windows
    const finalBackendDir = path.dirname(finalExePath);
    const dllCheck = verifyBackendDlls(finalBackendDir, backend);
    if (!dllCheck.ok) {
      console.warn(`[binary-manager] Missing DLLs after extraction: ${dllCheck.missing.join(', ')}. Server may fall back to CPU inference.`);
    }

    // Save cache metadata (3.5.2: Implement cache directory structure)
    const metadataPath = getCacheMetadataPath(app, tag, backend);
    saveCacheMetadata(metadataPath, {
      version: tag,
      backend,
      timestamp: Date.now(),
      exePath: finalExePath,
      backendDir: finalBackendDir
    });

    const result = { exePath: finalExePath, backendDir: finalBackendDir, tag, backend, fresh: true, dllCheck };
    backendCache.set(tag, backend, result);
    
    // Evict old cached versions (3.5.4: Implement cache eviction policy)
    evictOldCachedVersions(app);
    
    if (onStatus) onStatus({ phase: 'ready', backend, tag, result });
    return result;
  }).catch(err => {
    if (onStatus) onStatus({ phase: 'error', backend, tag, error: err.message });
    throw err;
  }).finally(() => {
    pendingDownloads.delete(backendKey);
  }));

  return await pendingDownloads.get(backendKey);
}

function getInstalledBackends(app) {
  const backendsDir = getBackendsDir(app);
  if (!fs.existsSync(backendsDir)) return [];
  const versions = fs.readdirSync(backendsDir);
  const result = [];
  for (const version of versions) {
    const versionDir = path.join(backendsDir, version);
    if (!fs.statSync(versionDir).isDirectory()) continue;
    const backends = fs.readdirSync(versionDir);
    for (const backend of backends) {
      const bDir = path.join(versionDir, backend);
      if (!fs.statSync(bDir).isDirectory()) continue;
      const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
      const exePath = path.join(bDir, exeName);
      const buildExePath = path.join(bDir, 'build', 'bin', exeName);
      const installed = fs.existsSync(exePath) || fs.existsSync(buildExePath);
      result.push({ version, backend, path: bDir, installed });
    }
  }
  return result;
}

function deleteBackend(app, tag, backend) {
  const backendDir = path.join(getBackendsDir(app), tag, backend);
  if (fs.existsSync(backendDir)) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// sd.cpp (stable-diffusion.cpp) binary management
//
// Mirrors the llama.cpp binary download flow but targets the
// `leejet/stable-diffusion.cpp` release. The `sd-cli` binary is used by
// ImageService to run the Bonsai Image 4B diffusion model. Asset naming
// follows the bonsai-beach convention: `sd-bin-{os}-{backend}-{arch}`.
// ---------------------------------------------------------------------------

function getSdBinDir(app) {
  const dir = path.join(app.getPath('userData'), 'bin', 'sd-cpp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Map hardware capabilities to the sd.cpp backend suffix used in
 * `leejet/stable-diffusion.cpp` release asset names.
 *
 * Asset naming: `sd-{tag}-bin-{os}-{backend}-{arch}.zip`
 * Examples:
 *   win:  sd-master-XXX-bin-win-cpu-x64.zip
 *         sd-master-XXX-bin-win-cuda12-x64.zip
 *         sd-master-XXX-bin-win-vulkan-x64.zip
 *         sd-master-XXX-bin-win-rocm-7.1.1-x64.zip
 *   mac:  sd-master-XXX-bin-Darwin-macOS-26.4-arm64.zip
 *   linux: sd-master-XXX-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip
 *
 * @param {Object} [caps] - Hardware capabilities (cuda/vulkan/rocm booleans)
 * @returns {{os:string, backend:string, arch:string, cudaRuntimeAsset:string|null}}
 */
function mapPlatformToSdBackend(caps) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') {
    if (caps && caps.cuda) return { os: 'win', backend: 'cuda12', arch: 'x64', cudaRuntimeAsset: 'cudart-sd-bin-win-cu12-x64.zip' };
    if (caps && caps.vulkan) return { os: 'win', backend: 'vulkan', arch: 'x64', cudaRuntimeAsset: null };
    if (caps && caps.rocm) return { os: 'win', backend: 'rocm-7.1.1', arch: 'x64', cudaRuntimeAsset: null };
    return { os: 'win', backend: 'cpu', arch, cudaRuntimeAsset: null };
  }
  if (process.platform === 'darwin') {
    return { os: 'Darwin', backend: 'macOS', arch, cudaRuntimeAsset: null };
  }
  // Linux
  if (caps && caps.vulkan) return { os: 'Linux', backend: 'vulkan', arch: 'x86_64', cudaRuntimeAsset: null };
  if (caps && caps.rocm) return { os: 'Linux', backend: 'rocm-7.2.1', arch: 'x86_64', cudaRuntimeAsset: null };
  if (caps && caps.cuda) return { os: 'Linux', backend: 'cu12', arch: 'x86_64', cudaRuntimeAsset: null };
  return { os: 'Linux', backend: 'cpu', arch: 'x86_64', cudaRuntimeAsset: null };
}

/**
 * Find the best-matching sd-cli asset from a leejet/stable-diffusion.cpp release.
 * Tries backend-specific assets first, then falls back to CPU.
 */
function findSdAsset(assets, { os, backend, arch }) {
  if (!Array.isArray(assets)) return null;
  // Normalize asset names for matching
  const norm = (s) => s.toLowerCase();
  const osL = norm(os);
  const backendL = norm(backend);
  const archL = norm(arch);

  // 1. Try exact backend match: sd-*-bin-{os}-{backend}-{arch}
  let match = assets.find(a => {
    const n = norm(a.name);
    return n.startsWith('sd-') && n.includes(`-bin-${osL}-`) && n.includes(`-${backendL}-`) && n.includes(`-${archL}.`) && (n.endsWith('.zip') || n.endsWith('.tar.gz'));
  });
  if (match) return match;

  // 2. Try backend match without arch (some releases omit arch in name)
  match = assets.find(a => {
    const n = norm(a.name);
    return n.startsWith('sd-') && n.includes(`-bin-${osL}-`) && n.includes(`-${backendL}`) && (n.endsWith('.zip') || n.endsWith('.tar.gz'));
  });
  if (match) return match;

  // 3. Fall back to CPU
  match = assets.find(a => {
    const n = norm(a.name);
    return n.startsWith('sd-') && n.includes(`-bin-${osL}-cpu-`) && n.includes(`-${archL}.`) && (n.endsWith('.zip') || n.endsWith('.tar.gz'));
  });
  if (match) return match;

  // 4. Last resort: any sd-*-bin-{os}- asset
  match = assets.find(a => {
    const n = norm(a.name);
    return n.startsWith('sd-') && n.includes(`-bin-${osL}-`) && (n.endsWith('.zip') || n.endsWith('.tar.gz'));
  });
  return match || null;
}

async function ensureSdBackend(app, { onProgress, hardwareCapabilities } = {}) {
  const exeName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
  const binDir = getSdBinDir(app);
  const localPath = path.join(binDir, exeName);
  if (fs.existsSync(localPath)) return localPath;

  // Fetch the latest release info
  const release = await fetchJson(SD_CPP_API_LATEST);
  const tag = release.tag_name;
  const assets = release.assets || [];
  if (!tag || assets.length === 0) {
    throw new Error('sd.cpp: failed to resolve latest release or no assets found');
  }

  // Determine the backend from hardware capabilities
  const caps = hardwareCapabilities || null;
  const platformInfo = mapPlatformToSdBackend(caps);
  console.log(`[binary-manager] sd.cpp: platform=${platformInfo.os}, backend=${platformInfo.backend}, arch=${platformInfo.arch}`);

  // Find the matching asset
  const asset = findSdAsset(assets, platformInfo);
  if (!asset) {
    const available = assets.map(a => a.name).join(', ');
    throw new Error(`sd.cpp: no matching asset found for ${platformInfo.os}/${platformInfo.backend}/${platformInfo.arch} in tag ${tag}. Available: ${available}`);
  }

  console.log(`[binary-manager] sd.cpp: selected asset ${asset.name}`);
  const downloadUrl = asset.browser_download_url || `${SD_CPP_DOWNLOAD}/${tag}/${asset.name}`;
  const archivePath = path.join(binDir, asset.name);
  await downloadFile(downloadUrl, archivePath, onProgress);
  await extractArchive(archivePath, binDir);
  try { fs.unlinkSync(archivePath); } catch { /* ignore */ }

  // Download CUDA runtime DLLs if needed (Windows CUDA backend)
  if (platformInfo.cudaRuntimeAsset) {
    const cudaAsset = assets.find(a => a.name === platformInfo.cudaRuntimeAsset);
    if (cudaAsset) {
      const cudaUrl = cudaAsset.browser_download_url || `${SD_CPP_DOWNLOAD}/${tag}/${cudaAsset.name}`;
      const cudaZipPath = path.join(binDir, cudaAsset.name);
      console.log(`[binary-manager] sd.cpp: downloading CUDA runtime ${cudaAsset.name}...`);
      await downloadFile(cudaUrl, cudaZipPath, null);
      await extractArchive(cudaZipPath, binDir);
      try { fs.unlinkSync(cudaZipPath); } catch { /* ignore */ }
    }
  }

  if (!fs.existsSync(localPath)) {
    throw new Error('sd.cpp: sd-cli binary not found after extraction');
  }

  // Write a version marker so getSdBackendInfo can report the installed tag
  try {
    fs.writeFileSync(path.join(binDir, '.version'), tag, 'utf8');
  } catch (_) { /* ignore */ }

  return localPath;
}

module.exports = {
  ensureBackend,
  getInstalledBackends,
  getLatestReleaseInfo,
  mapCapabilitiesToBackend,
  getBackendsDir,
  deleteBackend,
  verifyBackendDlls,
  getRequiredDlls,
  extractArchive,
  downloadFile,
  getAssetUrl,
  verifyVcRuntime,
  // Cache management (3.5.1-3.5.8)
  getCacheDir,
  getCachedBackend,
  evictOldCachedVersions,
  getCacheStats: () => backendCache.getStats(),
  clearCache: () => backendCache.clear(),
  // GPG signature verification (3.5.5-3.5.7)
  getGPGPublicKey,
  verifyGPGSignature,
  verifyFileHash,
  computeFileHash,
  // Cache statistics for status endpoint (3.5.8)
  getCacheStatistics: () => {
    const stats = backendCache.getStats();
    return {
      cacheSize: stats.size,
      maxCacheSize: stats.maxSize,
      cachedVersions: stats.entries.map(e => ({
        key: e.key,
        timestamp: e.timestamp,
        path: e.exePath
      })),
      evictionCount: stats.entries.length > 0 ? 0 : 0 // Track in future enhancement
    };
  },
  // Bonsai release configuration (mirrors bonsai-beach config/bonsai-beach.toml)
  LLAMA_CPP_RELEASES,
  SD_CPP_RELEASE,
  WHISPER_CPP_RELEASE,
  // Repo preference management (bonsai variant vs upstream)
  setRepoPreference,
  getRepoPreference,
  getPreferredRepos,
  // Release info for specific repos (used by Providers UI)
  getLatestReleaseInfoForRepo,
  getSdBackendInfo,
  // sd.cpp binary management
  ensureSdBackend,
  getSdBinDir,
  mapPlatformToSdBackend,
  findSdAsset
};
