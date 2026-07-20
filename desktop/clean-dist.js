const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, 'dist');

function killLockingProcesses() {
  try {
    // Kill common processes that lock app.asar
    const procs = ['electron.exe', 'app-builder.exe', 'alpaca.exe'];
    for (const proc of procs) {
      try {
        execSync(`taskkill /F /IM ${proc} 2>nul`, { stdio: 'ignore' });
      } catch (e) {
        // Process may not be running
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

function tryDelete(retries = 3, delay = 2000) {
  if (!fs.existsSync(distDir)) {
    console.log('dist directory does not exist, nothing to clean');
    return true;
  }

  for (let i = 0; i < retries; i++) {
    if (i > 0) {
      console.log(`Retry ${i}/${retries} after ${delay}ms...`);
      execSync(`ping -n ${Math.ceil(delay / 1000) + 1} 127.0.0.1 >nul`, { stdio: 'ignore' });
      killLockingProcesses();
    }

    // Try Windows cmd rmdir first (handles locked files better than Node.js)
    try {
      execSync(`cmd /c "rmdir /s /q \"${distDir}\" 2>nul"`, { stdio: 'ignore' });
      if (!fs.existsSync(distDir)) {
        console.log('Cleaned dist directory');
        return true;
      }
    } catch (e) {
      // Ignore
    }

    // Try Node.js rimraf with force
    try {
      fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 3 });
      if (!fs.existsSync(distDir)) {
        console.log('Cleaned dist directory');
        return true;
      }
    } catch (e) {
      console.log(`Delete attempt ${i + 1} failed: ${e.code}`);
    }
  }

  // Fallback: rename the locked directory
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fallbackName = `dist_old_${timestamp}`;
    const fallbackPath = path.join(__dirname, fallbackName);
    fs.renameSync(distDir, fallbackPath);
    console.log(`Could not delete dist, renamed to ${fallbackName}`);
    return true;
  } catch (e) {
    console.error(`Failed to rename dist: ${e.message}`);
    return false;
  }
}

// Main
console.log('Cleaning dist directory...');
killLockingProcesses();
const success = tryDelete();
if (!success) {
  console.error('ERROR: Could not clean dist directory. Please close any applications using it and try again.');
  process.exit(1);
}
