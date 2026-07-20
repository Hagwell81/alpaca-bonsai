/**
 * Build script for bundling jcodemunch-mcp as a standalone executable.
 *
 * This script invokes the PyInstaller build script inside the jcodemunch-mcp
 * repository. The resulting binary is copied to desktop/bin/ so it gets
 * included in the Electron app bundle (asarUnpack ensures it is extracted
 * alongside the app for subprocess spawning).
 *
 * Prerequisites:
 *   - Python 3.10+ installed and on PATH
 *   - jcodemunch-mcp source checked out at ../../../../../jcodemunch-mcp
 *     (relative to desktop directory)
 *
 * Usage:
 *   npm run build:jcm
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DESKTOP_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(DESKTOP_DIR, 'bin');
// Search for jcodemunch-mcp in multiple common locations
function findJcmRepo() {
  const candidates = [
    path.resolve(DESKTOP_DIR, '..', '..', '..', '..', 'jcodemunch-mcp'),
    path.resolve(DESKTOP_DIR, '..', '..', 'jcodemunch-mcp'),
    path.resolve(DESKTOP_DIR, '..', 'jcodemunch-mcp'),
    path.resolve(require('os').homedir(), 'source', 'repos', 'jcodemunch-mcp'),
    path.resolve(require('os').homedir(), 'repos', 'jcodemunch-mcp'),
    path.resolve(require('os').homedir(), 'jcodemunch-mcp'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const JCM_REPO = findJcmRepo();
const BUILD_SCRIPT = path.join(JCM_REPO, 'scripts', 'build-standalone.py');

function ensureBinDir() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log('[build:jcm] Created bin directory:', BIN_DIR);
  }
}

function detectPython() {
  const candidates = ['python3', 'python', 'py'];
  for (const bin of candidates) {
    try {
      const out = execSync(`${bin} --version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`[build:jcm] Found ${bin}: ${out.trim()}`);
      return bin;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function main() {
  console.log('[build:jcm] Starting jcodemunch-mcp standalone build...');

  if (!JCM_REPO || !fs.existsSync(JCM_REPO)) {
    console.error('[build:jcm] jcodemunch-mcp repository not found in any known location.');
    console.error('[build:jcm] Skipping build. The app will fall back to system Python at runtime.');
    process.exit(0); // Not a fatal error — app still works with system Python
  }
  console.log(`[build:jcm] Found jcodemunch-mcp at: ${JCM_REPO}`);

  if (!fs.existsSync(BUILD_SCRIPT)) {
    console.error(`[build:jcm] Build script not found: ${BUILD_SCRIPT}`);
    console.error('[build:jcm] Skipping build.');
    process.exit(0);
  }

  const python = detectPython();
  if (!python) {
    console.error('[build:jcm] Python not found. Cannot build standalone binary.');
    console.error('[build:jcm] The app will fall back to system Python at runtime.');
    process.exit(0);
  }

  ensureBinDir();

  // Check if PyInstaller is installed
  try {
    execSync(`${python} -m PyInstaller --version`, { encoding: 'utf8', timeout: 10000 });
  } catch (_) {
    console.log('[build:jcm] Installing PyInstaller...');
    try {
      execSync(`${python} -m pip install pyinstaller`, { stdio: 'inherit', timeout: 120000 });
    } catch (err) {
      console.error('[build:jcm] Failed to install PyInstaller:', err.message);
      process.exit(0);
    }
  }

  // Run the build
  console.log('[build:jcm] Building standalone executable with PyInstaller...');
  console.log(`[build:jcm] Repo: ${JCM_REPO}`);

  try {
    execSync(`${python} "${BUILD_SCRIPT}"`, {
      cwd: JCM_REPO,
      stdio: 'inherit',
      timeout: 300000, // 5 minutes
    });
  } catch (err) {
    console.error('[build:jcm] PyInstaller build failed:', err.message);
    console.error('[build:jcm] The app will fall back to system Python at runtime.');
    process.exit(0);
  }

  // Determine expected binary name and location
  const platform = process.platform;
  let binaryName;
  if (platform === 'win32') {
    binaryName = 'jcodemunch-mcp.exe';
  } else if (platform === 'darwin') {
    binaryName = 'jcodemunch-mcp-macos';
  } else {
    binaryName = 'jcodemunch-mcp-linux';
  }

  const builtBinary = path.join(JCM_REPO, 'dist', 'jcodemunch-mcp', binaryName);

  if (!fs.existsSync(builtBinary)) {
    console.error(`[build:jcm] Expected binary not found after build: ${builtBinary}`);
    console.error('[build:jcm] The app will fall back to system Python at runtime.');
    process.exit(0);
  }

  // Copy to desktop/bin/
  const dest = path.join(BIN_DIR, binaryName);
  fs.copyFileSync(builtBinary, dest);
  const stats = fs.statSync(dest);
  console.log(`[build:jcm] Binary copied to: ${dest}`);
  console.log(`[build:jcm] Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  console.log('[build:jcm] Done.');
}

main();
