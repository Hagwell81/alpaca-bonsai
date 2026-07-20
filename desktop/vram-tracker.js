/**
 * VRAM Tracker
 *
 * Wraps VramBudgetManager with real-time aggregate tracking of loaded runners.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

const { execSync } = require('child_process');

const OS_OVERHEAD_MB = 512;

// ---------------------------------------------------------------------------
// GPU free-memory probe
// ---------------------------------------------------------------------------

function queryGpuFreeMB() {
  // nvidia-smi
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    );
    const lines = output
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const freeMB = parseInt(lines[0].trim(), 10);
      if (!isNaN(freeMB)) return freeMB;
    }
  } catch (_e) {
    // nvidia-smi not available
  }

  // rocm-smi
  try {
    const output = execSync('rocm-smi --showmeminfo', {
      encoding: 'utf8',
      timeout: 3000,
    });
    const match = output.match(/Free Memory.*?(\d+)\s*MB/i);
    if (match) {
      const freeMB = parseInt(match[1], 10);
      if (!isNaN(freeMB)) return freeMB;
    }
  } catch (_e) {
    // rocm-smi not available
  }

  return Infinity;
}

// ---------------------------------------------------------------------------
// VramTracker class
// ---------------------------------------------------------------------------

class VramTracker {
  /**
   * @param {Object} vramBudgetManager
   * @param {Object} [options={}]
   * @param {Function} [options.gpuFreeQuery] - override GPU free-memory probe
   */
  constructor(vramBudgetManager, options = {}) {
    this.vramBudgetManager = vramBudgetManager || null;
    this.gpuFreeQuery = options.gpuFreeQuery || queryGpuFreeMB;
    this.allocations = new Map(); // modelPath -> mb
    this.totalMB = 0;
    this.detected = false;
  }

  async init() {
    if (
      this.vramBudgetManager &&
      typeof this.vramBudgetManager.detect === 'function'
    ) {
      try {
        const result = await this.vramBudgetManager.detect();
        this.totalMB = Number.isFinite(result.totalMB) ? result.totalMB : 0;
        this.detected = result.detected === true;
      } catch (_err) {
        this.detected = false;
      }
    } else {
      this.detected = false;
    }
  }

  registerRunner(modelPath, mb) {
    if (!modelPath || typeof modelPath !== 'string') {
      throw new Error('Invalid modelPath');
    }
    if (!Number.isFinite(mb) || mb < 0) {
      throw new Error('Invalid VRAM allocation');
    }
    this.allocations.set(modelPath, mb);
  }

  deregisterRunner(modelPath) {
    this.allocations.delete(modelPath);
  }

  getTotalAllocated() {
    let sum = 0;
    for (const mb of this.allocations.values()) {
      sum += mb;
    }
    return sum;
  }

  getAvailable() {
    if (!this.detected) {
      return Infinity;
    }

    const allocated = this.getTotalAllocated();
    const predictedFree = this.totalMB - allocated - OS_OVERHEAD_MB;
    const gpuReportedFree = this.gpuFreeQuery();

    const conservative = Math.min(
      Number.isFinite(predictedFree) ? predictedFree : 0,
      Number.isFinite(gpuReportedFree) ? gpuReportedFree : Infinity
    );

    return Math.max(0, conservative);
  }

  canFit(requiredMB) {
    if (!this.detected) {
      return true;
    }
    if (!Number.isFinite(requiredMB) || requiredMB < 0) {
      return true;
    }
    return this.getAvailable() >= requiredMB;
  }

  getGpuReportedFree() {
    if (!this.detected) {
      return Infinity;
    }
    const reported = this.gpuFreeQuery();
    return Number.isFinite(reported) ? reported : Infinity;
  }

  getAllocationsMB() {
    return Array.from(this.allocations.values());
  }

  getSnapshot() {
    return {
      totalMB: this.totalMB,
      usedMB: this.getTotalAllocated(),
      availableMB: this.getAvailable(),
      detected: this.detected,
      allocations: Array.from(this.allocations.entries()).map(([modelPath, mb]) => ({
        modelPath,
        mb,
      })),
    };
  }
}

module.exports = { VramTracker, OS_OVERHEAD_MB, queryGpuFreeMB };
