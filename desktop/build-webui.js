const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyFileIfExists(src, dest) {
  if (fs.existsSync(src)) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('Copied', path.basename(src));
  }
}

// ============================================================================
// Copy webui built files
// ============================================================================
// The SvelteKit webui (../webui) is configured to build to ../public.
// We copy those static files into desktop/public so electron-builder
// can bundle them.
// ============================================================================

const webuiBuildDir = path.join(__dirname, '..', 'public');
const webuiTargetDir = path.join(__dirname, 'public');

console.log('Copying webui from', webuiBuildDir, 'to', webuiTargetDir);

if (!fs.existsSync(webuiBuildDir)) {
  console.warn(`Webui build directory not found at ${webuiBuildDir}.`);
  console.warn('Build the webui first: cd ../webui && npm run build');
} else {
  if (!fs.existsSync(webuiTargetDir)) {
    fs.mkdirSync(webuiTargetDir, { recursive: true });
  }
  copyRecursiveSync(webuiBuildDir, webuiTargetDir);
  console.log('Webui copy complete!');
}

// ============================================================================
// Copy bundled llama-server binary and DLLs (optional local build)
// ============================================================================
// If llama.cpp has been built locally, copy the binaries so they are
// bundled and do not need to be downloaded at runtime.
// If no local build exists, binary-manager.js will auto-download the
// correct backend from GitHub releases on first server start.
// ============================================================================

const localBuildDirs = [
  // Local llama.cpp build relative to this standalone project
  path.join(__dirname, '..', '..', 'llama.cpp', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', 'llama.cpp', 'build', 'bin'),
  // If cloned as a submodule or sibling
  path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', '..', 'build', 'bin'),
];

const binTargetDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binTargetDir)) {
  fs.mkdirSync(binTargetDir, { recursive: true });
}

let localBuildFound = false;
for (const buildReleaseDir of localBuildDirs) {
  if (!fs.existsSync(buildReleaseDir)) continue;

  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const serverExeSrc = path.join(buildReleaseDir, exeName);
  const serverExeDest = path.join(binTargetDir, exeName);

  if (fs.existsSync(serverExeSrc)) {
    console.log(`Copying server binary from ${buildReleaseDir}...`);
    fs.copyFileSync(serverExeSrc, serverExeDest);
    console.log(`Copied ${exeName}`);
    localBuildFound = true;

    // Copy all DLLs / shared libraries
    const libExt = process.platform === 'win32' ? '.dll' : (process.platform === 'darwin' ? '.dylib' : '.so');
    const libFiles = fs.readdirSync(buildReleaseDir).filter(f => f.endsWith(libExt));
    libFiles.forEach(lib => {
      const src = path.join(buildReleaseDir, lib);
      const dest = path.join(binTargetDir, lib);
      fs.copyFileSync(src, dest);
      console.log('Copied', lib);
    });
    break;
  }
}

if (!localBuildFound) {
  console.log('No local llama.cpp build found — binaries will be auto-downloaded from GitHub releases at runtime.');
}

console.log('Server binary step complete!');

// ============================================================================
// Copy bundled whisper.cpp binary (optional local build)
// ============================================================================
// If whisper.cpp has been built locally, copy the whisper-cli binary so it
// is bundled and does not need to be downloaded at runtime.
// If no local build exists, voice-service.js will auto-download from GitHub
// releases on first STT use.
// ============================================================================

const whisperBuildDirs = [
  path.join(__dirname, '..', '..', 'whisper.cpp', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', 'whisper.cpp', 'build', 'bin'),
  path.join(__dirname, '..', '..', '..', 'whisper.cpp', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', '..', 'whisper.cpp', 'build', 'bin'),
];

const voiceTargetDir = path.join(__dirname, 'voice');
if (!fs.existsSync(voiceTargetDir)) {
  fs.mkdirSync(voiceTargetDir, { recursive: true });
}

let whisperBuildFound = false;
for (const whisperDir of whisperBuildDirs) {
  if (!fs.existsSync(whisperDir)) continue;

  const whisperExeName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const whisperExeSrc = path.join(whisperDir, whisperExeName);
  const whisperExeDest = path.join(voiceTargetDir, whisperExeName);

  if (fs.existsSync(whisperExeSrc)) {
    console.log(`Copying whisper binary from ${whisperDir}...`);
    fs.copyFileSync(whisperExeSrc, whisperExeDest);
    console.log(`Copied ${whisperExeName}`);
    whisperBuildFound = true;

    // Copy all DLLs / shared libraries
    const whisperLibExt = process.platform === 'win32' ? '.dll' : (process.platform === 'darwin' ? '.dylib' : '.so');
    const whisperLibs = fs.readdirSync(whisperDir).filter(f => f.endsWith(whisperLibExt));
    whisperLibs.forEach(lib => {
      const src = path.join(whisperDir, lib);
      const dest = path.join(voiceTargetDir, lib);
      fs.copyFileSync(src, dest);
      console.log('Copied whisper lib', lib);
    });
    break;
  }
}

if (!whisperBuildFound) {
  console.log('No local whisper.cpp build found — whisper-cli will be auto-downloaded from GitHub releases on first use.');
}

console.log('Whisper binary step complete!');

// ============================================================================
// Copy alpaca-tui binary (Rust TUI for model management + chat)
// ============================================================================
// If the alpaca-tui has been built (cd ../tui && cargo build --release),
// copy the binary into resources/tui/ so it is bundled with the desktop
// app and discoverable by findTuiBinary() in main.js.
// If no build exists, the tray menu "Open Terminal UI" will show a dialog
// instructing the user to build it.
// ============================================================================

const tuiExeName = process.platform === 'win32' ? 'alpaca-tui.exe' : 'alpaca-tui';
const tuiBuildDir = path.join(__dirname, '..', 'tui', 'target', 'release');
const tuiExeSrc = path.join(tuiBuildDir, tuiExeName);
const tuiTargetDir = path.join(__dirname, 'resources', 'tui');

if (fs.existsSync(tuiExeSrc)) {
  if (!fs.existsSync(tuiTargetDir)) {
    fs.mkdirSync(tuiTargetDir, { recursive: true });
  }
  const tuiExeDest = path.join(tuiTargetDir, tuiExeName);
  fs.copyFileSync(tuiExeSrc, tuiExeDest);
  console.log(`Copied TUI binary: ${tuiExeName}`);

  // Copy any dynamic libraries the TUI depends on (e.g. Vulkan layers,
  // CUDA runtime) that are alongside the binary in the release directory.
  const tuiLibExt = process.platform === 'win32' ? '.dll' : (process.platform === 'darwin' ? '.dylib' : '.so');
  const tuiLibs = fs.readdirSync(tuiBuildDir).filter(f => f.endsWith(tuiLibExt));
  tuiLibs.forEach(lib => {
    const src = path.join(tuiBuildDir, lib);
    const dest = path.join(tuiTargetDir, lib);
    fs.copyFileSync(src, dest);
    console.log('Copied TUI lib', lib);
  });
} else {
  console.log('No alpaca-tui build found — build it with: cd ../tui && cargo build --release');
}

console.log('TUI binary step complete!');

// ============================================================================
// Copy alpaca media assets
// ============================================================================

const mediaSourceDir = path.join(__dirname, '..', 'media');
const resourcesTargetDir = path.join(__dirname, 'resources');

console.log('Copying alpaca media from', mediaSourceDir, 'to', resourcesTargetDir);

if (!fs.existsSync(resourcesTargetDir)) {
  fs.mkdirSync(resourcesTargetDir, { recursive: true });
}

if (fs.existsSync(mediaSourceDir)) {
  const mediaFiles = fs.readdirSync(mediaSourceDir).filter(f =>
    f.endsWith('.png') || f.endsWith('.ico') || f.endsWith('.svg') || f.endsWith('.gif')
  );
  mediaFiles.forEach(file => {
    const src = path.join(mediaSourceDir, file);
    const dest = path.join(resourcesTargetDir, file);
    fs.copyFileSync(src, dest);
    console.log('Copied media', file);
  });
  console.log('Media copy complete!');
} else {
  console.log('Media directory not found, skipping media copy');
}
