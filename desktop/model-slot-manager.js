const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const http = require('http');
const { buildArgs } = require('./slot-args-builder');
const { fetchAndDetect } = require('./chat-template-detector');

/**
 * SlotManager owns every llama-server child process.
 * Single instance per app.
 *
 * Manages five fixed slots with reserved ports 13434-13438 and purposes
 * (primary, secondary, vision, embedding, coding).
 *
 * Implements a state machine with legal transitions:
 * idle -> starting -> running -> stopping -> idle
 * idle -> starting -> error -> idle
 * running -> error -> idle
 * error -> starting (after reset)
 *
 * Emits events on every state transition for UI subscription.
 */
class SlotManager extends EventEmitter {
  // Constants (Req 1.1, 1.2)
  static SLOT_PORTS = [13434, 13435, 13436, 13437, 13438];
  static SLOT_PURPOSES = ['primary', 'secondary', 'vision', 'embedding', 'coding'];
  static HEALTH_TIMEOUT_MS = 90_000;
  static STOP_GRACE_MS = 15_000;

  /**
   * @param {Object} options
   * @param {VramBudgetManager} options.vramBudgetManager
   * @param {ModelConfigStore} options.modelConfigStore
   * @param {Object} options.logger - logger instance (console or similar)
   */
  constructor({ vramBudgetManager, modelConfigStore, logger = console } = {}) {
    super();
    this.vramBudgetManager = vramBudgetManager;
    this.modelConfigStore = modelConfigStore;
    this.logger = logger;

    // Internal slot records: id -> Slot
    this.slots = new Map();
  }

  /**
   * Initialize five idle slots.
   * Asserts nothing is already listening on 13434 (legacy server detection).
   * Flags Slot 0 as error with migration hint if legacy server is detected.
   *
   * Req 1.1, 1.2, 19.4
   */
  async init() {
    // Create five Slot records in idle state
    for (let i = 0; i < 5; i++) {
      this.slots.set(i, {
        id: i,
        port: SlotManager.SLOT_PORTS[i],
        purpose: SlotManager.SLOT_PURPOSES[i],
        status: 'idle',
        modelPath: null,
        mmprojPath: null,
        process: null,
        lastUsed: null,
        supportsTools: null,
        chatTemplate: null,
        metrics: {
          tokensGenerated: 0,
          tokensPrompted: 0,
          requestsServed: 0,
          avgLatencyMs: 0,
        },
        lastError: null,
        _startedAt: null,
        _healthTimer: null,
        _stopQueuedStart: null,
      });
    }

    // Check for legacy server on port 13434 (Req 19.4)
    const legacyServerDetected = await this._checkLegacyServer();
    if (legacyServerDetected) {
      const slot0 = this.slots.get(0);
      slot0.status = 'error';
      slot0.lastError = {
        code: 'legacy-server-detected',
        stderrTail: 'Legacy llama-server is still running on port 13434. Please stop it before starting Phase 1 slots.',
        at: new Date().toISOString(),
      };
      this.emit('slot-status-changed', {
        slotId: 0,
        from: 'idle',
        to: 'error',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * Check if legacy server is listening on port 13434.
   * @private
   * @returns {Promise<boolean>}
   */
  async _checkLegacyServer() {
    return new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:13434/health', { timeout: 300 }, (res) => {
        req.destroy();
        resolve(true);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  // ============================================================================
  // Query methods (pure over in-memory state)
  // ============================================================================

  /**
   * Get a slot by id.
   * @param {number} id - slot id 0-4
   * @returns {Slot | null}
   */
  getSlot(id) {
    return this.slots.get(id) || null;
  }

  /**
   * Get a slot by port.
   * Returns null for non-reserved ports (Req 1.6).
   * @param {number} port
   * @returns {Slot | null}
   */
  getSlotByPort(port) {
    for (const slot of this.slots.values()) {
      if (slot.port === port) {
        return slot;
      }
    }
    return null;
  }

  /**
   * List all five slots.
   * @returns {Slot[]} - array of length 5
   */
  listSlots() {
    const slots = [];
    for (let i = 0; i < 5; i++) {
      slots.push(this.slots.get(i));
    }
    return slots;
  }

  /**
   * Get all running slots.
   * @returns {Slot[]} - slots where status === 'running'
   */
  getActiveSlots() {
    return this.listSlots().filter(s => s.status === 'running');
  }

  /**
   * Get a slot by purpose.
   * @param {string} purpose - 'primary' | 'secondary' | 'vision' | 'embedding' | 'coding'
   * @returns {Slot | null}
   */
  getSlotByPurpose(purpose) {
    for (const slot of this.slots.values()) {
      if (slot.purpose === purpose) {
        return slot;
      }
    }
    return null;
  }

  // ============================================================================
  // Lifecycle methods
  // ============================================================================

  /**
   * Start a slot with the given configuration.
   * Transitions idle -> starting, spawns llama-server, probes health.
   * Emits slot-status-changed events on every transition.
   *
   * Req 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.10
   *
   * @param {number} id - slot id 0-4
   * @param {SlotConfig} slotConfig - { modelPath, mmprojPath?, port, purpose, advancedArgs, draftModelPath? }
   * @returns {Promise<Slot>}
   * @throws {SlotBusyError} if slot is already starting or running
   * @throws {VramBudgetError} if VRAM budget exceeded
   */
  async startSlot(id, slotConfig) {
    const slot = this.getSlot(id);
    if (!slot) {
      throw new SlotNotFoundError(id);
    }

    // Req 2.8: throw SlotBusyError if already starting or running
    if (slot.status === 'starting' || slot.status === 'running') {
      throw new SlotBusyError(id, slot.status);
    }

    // Req 2.9: if stopping, queue the start and wait for stop to complete
    if (slot.status === 'stopping') {
      return new Promise((resolve, reject) => {
        slot._stopQueuedStart = { slotConfig, resolve, reject };
      });
    }

    // Check VRAM budget (Req 2.2)
    if (this.vramBudgetManager) {
      const activeSlots = this.getActiveSlots();
      const activeAllocations = activeSlots.map(s => s._estimatedMB || 0);
      const vramContext = {
        totalMB: this.vramBudgetManager.totalMB || 0,
        reservedMB: 512,
        activeAllocationsMB: activeAllocations,
        detected: this.vramBudgetManager.detected !== false,
      };

      const estimateConfig = {
        modelFileSizeMB: 0, // Would need to stat the file
        ctxSize: slotConfig.advancedArgs.ctxSize,
        quantization: 'q4', // Default estimate
        purpose: slotConfig.purpose,
      };

      const canFitResult = this.vramBudgetManager.canFit?.(estimateConfig, vramContext);
      if (canFitResult && !canFitResult.ok) {
        throw new VramBudgetError(
          `Insufficient VRAM for slot ${id}`,
          canFitResult.requiredMB,
          vramContext.totalMB - vramContext.reservedMB
        );
      }
    }

    // Transition idle -> starting (Req 2.2)
    this._transitionSlot(slot, 'starting');

    // Spawn llama-server (Req 2.3)
    const argv = buildArgs(slotConfig);
    const child = spawn('llama-server', argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    slot.process = child;
    slot.modelPath = slotConfig.modelPath;
    slot.mmprojPath = slotConfig.mmprojPath || null;
    slot._startedAt = Date.now();

    // Capture stderr tail (Req 2.5)
    let stderrBuffer = Buffer.alloc(0);
    child.stderr.on('data', (chunk) => {
      stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
    });

    // Handle child exit (Req 2.5)
    child.on('exit', (code) => {
      if (slot._healthTimer) {
        clearTimeout(slot._healthTimer);
        slot._healthTimer = null;
      }

      // If we're still in starting or running, transition to error
      if (slot.status === 'starting' || slot.status === 'running') {
        slot.lastError = {
          code: code || 'unknown',
          stderrTail: stderrBuffer.toString('utf8'),
          at: new Date().toISOString(),
        };
        this._transitionSlot(slot, 'error');
      }

      // If we're stopping, transition to idle
      if (slot.status === 'stopping') {
        this._transitionSlot(slot, 'idle');
        slot.process = null;
        slot.modelPath = null;
        slot.mmprojPath = null;

        // Handle queued start (Req 2.9)
        if (slot._stopQueuedStart) {
          const { slotConfig: queuedConfig, resolve, reject } = slot._stopQueuedStart;
          slot._stopQueuedStart = null;
          this.startSlot(id, queuedConfig).then(resolve).catch(reject);
        }
      }
    });

    // Start health probe loop (Req 2.4)
    return new Promise((resolve, reject) => {
      const probeHealth = async () => {
        try {
          const response = await this._probeHealth(slotConfig.port);
          if (response === 200) {
            // Transition starting -> running (Req 2.3)
            if (slot._healthTimer) {
              clearTimeout(slot._healthTimer);
              slot._healthTimer = null;
            }

            this._transitionSlot(slot, 'running');

            // Fetch props via Chat_Template_Detector (Req 14.1, 14.2)
            try {
              const { supportsTools, chatTemplate } = await fetchAndDetect(slotConfig.port);
              slot.supportsTools = supportsTools;
              slot.chatTemplate = chatTemplate;
              this.emit('slot-props-loaded', {
                slotId: id,
                supportsTools,
                chatTemplate,
              });
            } catch (err) {
              this.logger.warn(`Failed to detect tool support for slot ${id}: ${err.message}`);
            }

            resolve(slot);
          } else {
            // Still waiting, schedule next probe
            slot._healthTimer = setTimeout(probeHealth, 1000);
          }
        } catch (err) {
          // Still waiting, schedule next probe
          slot._healthTimer = setTimeout(probeHealth, 1000);
        }
      };

      // Start probing
      slot._healthTimer = setTimeout(probeHealth, 1000);

      // Timeout after 90s (Req 2.4)
      const timeoutTimer = setTimeout(() => {
        if (slot._healthTimer) {
          clearTimeout(slot._healthTimer);
          slot._healthTimer = null;
        }

        if (slot.status === 'starting') {
          slot.lastError = {
            code: 'health-timeout',
            stderrTail: stderrBuffer.toString('utf8'),
            at: new Date().toISOString(),
          };
          this._transitionSlot(slot, 'error');

          // Terminate the process
          if (child.pid) {
            try {
              process.kill(child.pid, 'SIGTERM');
            } catch (e) {
              // Process may have already exited
            }
          }

          reject(new Error(`Health probe timeout for slot ${id}`));
        }
      }, SlotManager.HEALTH_TIMEOUT_MS);
    });
  }

  /**
   * Probe health endpoint of a slot.
   * @private
   * @param {number} port
   * @returns {Promise<number>} HTTP status code
   */
  async _probeHealth(port) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 }, (res) => {
        req.destroy();
        resolve(res.statusCode);
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Health probe timeout'));
      });
    });
  }

  /**
   * Stop a slot gracefully.
   * Transitions running -> stopping, sends SIGTERM, waits 15s, then SIGKILL.
   * Transitions stopping -> idle when process exits.
   *
   * Req 2.6, 2.7, 2.10
   *
   * @param {id} id - slot id 0-4
   * @returns {Promise<void>}
   */
  async stopSlot(id) {
    const slot = this.getSlot(id);
    if (!slot) {
      throw new SlotNotFoundError(id);
    }

    // Only stop if running
    if (slot.status !== 'running') {
      return;
    }

    // Transition running -> stopping (Req 2.6)
    this._transitionSlot(slot, 'stopping');

    if (!slot.process) {
      this._transitionSlot(slot, 'idle');
      slot.modelPath = null;
      slot.mmprojPath = null;
      return;
    }

    // Send SIGTERM and wait up to 15s (Req 2.6)
    return new Promise((resolve) => {
      const pid = slot.process.pid;

      const killTimer = setTimeout(() => {
        // Send SIGKILL if still running
        try {
          process.kill(pid, 'SIGKILL');
        } catch (e) {
          // Process may have already exited
        }
      }, SlotManager.STOP_GRACE_MS);

      // Wait for process exit
      slot.process.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      // Send SIGTERM
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {
        // Process may have already exited
        clearTimeout(killTimer);
        resolve();
      }
    });
  }

  /**
   * Restart a slot: stop then start with new config.
   *
   * @param {number} id
   * @param {SlotConfig} slotConfig
   * @returns {Promise<Slot>}
   */
  async restartSlot(id, slotConfig) {
    await this.stopSlot(id);
    return this.startSlot(id, slotConfig);
  }

  /**
   * Reset a slot from error to idle.
   *
   * Req 2 transition: error -> idle
   *
   * @param {number} id
   * @returns {Promise<void>}
   */
  async resetSlot(id) {
    const slot = this.getSlot(id);
    if (!slot) {
      throw new SlotNotFoundError(id);
    }

    if (slot.status !== 'error') {
      return;
    }

    this._transitionSlot(slot, 'idle');
    slot.lastError = null;
  }

  /**
   * Register an externally-spawned llama-server process with the slot manager.
   *
   * Use when main.js spawns llama-server directly (via startLlamaServer()) but
   * wants the API Gateway to be able to route requests to it. This transitions
   * the target slot from idle/error to running without spawning a new process.
   *
   * The slot's process field is set to the provided child process so that
   * stopSlot() can kill it if needed. The modelPath and mmprojPath are recorded
   * for routing and metadata purposes.
   *
   * @param {number} id - slot id 0-4
   * @param {Object} options
   * @param {import('child_process').ChildProcess} options.process - the spawned llama-server process
   * @param {string} options.modelPath - path to the model file
   * @param {string} [options.mmprojPath] - path to the mmproj file (for vision)
   * @param {string} [options.purpose] - slot purpose override (defaults to slot's built-in purpose)
   * @param {boolean} [options.supportsTools] - whether the model supports tool calls
   * @param {string} [options.chatTemplate] - detected chat template
   * @returns {Promise<Slot>} the updated slot
   * @throws {SlotNotFoundError} if slot id is invalid
   * @throws {SlotBusyError} if slot is already starting or running
   */
  async registerExternalRunner(id, { process: childProcess, modelPath, mmprojPath, purpose, supportsTools, chatTemplate }) {
    const slot = this.getSlot(id);
    if (!slot) {
      throw new SlotNotFoundError(id);
    }

    if (slot.status === 'starting' || slot.status === 'running') {
      throw new SlotBusyError(id, slot.status);
    }

    // If stopping, wait for the stop to complete first
    if (slot.status === 'stopping') {
      await new Promise((resolve) => {
        const check = () => {
          if (slot.status !== 'stopping') {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }

    // Transition to running
    this._transitionSlot(slot, 'running');
    slot.process = childProcess;
    slot.modelPath = modelPath;
    slot.mmprojPath = mmprojPath || null;
    slot.purpose = purpose || slot.purpose;
    slot.supportsTools = supportsTools ?? null;
    slot.chatTemplate = chatTemplate || null;
    slot.lastUsed = new Date().toISOString();
    slot._startedAt = Date.now();
    slot.lastError = null;

    // Attach exit handler to transition slot back to idle when the process dies
    if (childProcess) {
      childProcess.once('exit', (code, signal) => {
        if (slot.status === 'running') {
          this._transitionSlot(slot, 'idle');
          slot.process = null;
          slot.modelPath = null;
          slot.mmprojPath = null;
          slot._startedAt = null;
          if (code !== 0 && code !== null) {
            slot.lastError = {
              code: 'external_runner_exit',
              stderrTail: `External runner exited with code ${code}, signal ${signal}`,
              at: new Date().toISOString(),
            };
            this._transitionSlot(slot, 'error');
          }
        }
      });
    }

    this.logger.log(`[SlotManager] Registered external runner on slot ${id} (port ${slot.port}, model ${modelPath})`);
    return slot;
  }

  /**
   * Stop all running slots in parallel.
   * Used by app shutdown (Req 5.5).
   *
   * @returns {Promise<void>}
   */
  async stopAll() {
    const promises = this.getActiveSlots().map(slot => this.stopSlot(slot.id));
    await Promise.all(promises);
  }

  /**
   * Transition a slot to a new status and emit event.
   * @private
   * @param {Slot} slot
   * @param {string} newStatus
   */
  _transitionSlot(slot, newStatus) {
    const oldStatus = slot.status;
    slot.status = newStatus;
    this.emit('slot-status-changed', {
      slotId: slot.id,
      from: oldStatus,
      to: newStatus,
      at: new Date().toISOString(),
    });
  }

  // ============================================================================
  // Routing (pure function, also exported standalone)
  // ============================================================================

  /**
   * Select the best slot for a request.
   * Pure function: no mutations, deterministic output.
   *
   * Routing rules (Req 3):
   * (a) exact model match -> return that slot
   * (b) image attachment + vision running -> return vision
   * (c) message matches /```|\bjson\b/i + coding running -> return coding
   * (d) primary running -> return primary
   * (e) else return lowest-id running slot, or null if none
   *
   * Req 3.1-3.8
   *
   * @param {string} message - last user message text
   * @param {Array} attachments - image_url objects
   * @param {string} requestedModel - model name/path from request
   * @param {Slot[]} slots - all five slots
   * @returns {Slot | null}
   */
  selectSlot(message, attachments, requestedModel, slots) {
    // Delegate to the pure function
    const { selectSlot: selectSlotPure } = require('./slot-selector');
    return selectSlotPure(message, attachments, requestedModel, slots);
  }
}

// ============================================================================
// Pure helper functions
// ============================================================================

/**
 * Build child process environment with optional CUDA_VISIBLE_DEVICES pinning.
 * Pure function: does not mutate sourceEnv.
 *
 * @param {SlotConfig} slotConfig
 * @param {Object} sourceEnv - defaults to process.env
 * @returns {Object} - new environment object
 */
function _buildChildEnv(slotConfig, sourceEnv = process.env) {
  const env = { ...sourceEnv };
  const v = slotConfig.visibleDevices;
  
  if (Array.isArray(v) && v.length > 0) {
    const normalized = Array.from(new Set(v))
      .filter(n => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b)
      .join(',');
    env.CUDA_VISIBLE_DEVICES = normalized;
  }
  // else: do not modify env; do not delete inherited CUDA_VISIBLE_DEVICES
  
  return env;
}

/**
 * Validate slot configuration including visibleDevices.
 * Pure function: returns validation result.
 *
 * @param {SlotConfig} slotConfig
 * @param {Object} budget - { detected: boolean, gpuCount: number, ... }
 * @returns {{ ok: true } | { ok: false, field: string, reason: string }}
 */
function validateSlotConfig(slotConfig, budget) {
  // Phase-1 slot-config checks (basic structure)
  if (!slotConfig || typeof slotConfig !== 'object') {
    return { ok: false, field: 'slotConfig', reason: 'Slot config must be an object' };
  }
  
  if (!slotConfig.modelPath || typeof slotConfig.modelPath !== 'string') {
    return { ok: false, field: 'modelPath', reason: 'Model path is required and must be a string' };
  }
  
  if (!slotConfig.purpose || typeof slotConfig.purpose !== 'string') {
    return { ok: false, field: 'purpose', reason: 'Purpose is required and must be a string' };
  }
  
  // Validate visibleDevices
  const v = slotConfig.visibleDevices;
  
  // visibleDevices is optional, but if present must be an array
  if (v !== undefined && v !== null) {
    if (!Array.isArray(v)) {
      return { ok: false, field: 'visibleDevices', reason: 'visibleDevices must be an array' };
    }
    
    // Check each entry is a non-negative integer
    for (let i = 0; i < v.length; i++) {
      if (!Number.isInteger(v[i]) || v[i] < 0) {
        return {
          ok: false,
          field: 'visibleDevices',
          reason: `visibleDevices[${i}] must be a non-negative integer, got ${JSON.stringify(v[i])}`
        };
      }
      
      // When budget.detected === true, validate upper bound
      if (budget.detected === true && budget.gpuCount !== undefined) {
        if (v[i] >= budget.gpuCount) {
          return {
            ok: false,
            field: 'visibleDevices',
            reason: `visibleDevices[${i}] = ${v[i]} exceeds detected GPU count ${budget.gpuCount}`
          };
        }
      }
    }
  }
  
  return { ok: true };
}

// ============================================================================
// Error classes
// ============================================================================

class SlotBusyError extends Error {
  constructor(slotId, currentStatus) {
    super(`Slot ${slotId} is busy (status: ${currentStatus})`);
    this.name = 'SlotBusyError';
    this.slotId = slotId;
    this.currentStatus = currentStatus;
  }
}

class SlotNotFoundError extends Error {
  constructor(slotId) {
    super(`Slot ${slotId} not found`);
    this.name = 'SlotNotFoundError';
    this.slotId = slotId;
  }
}

class VramBudgetError extends Error {
  constructor(message, requiredMB, availableMB) {
    super(message);
    this.name = 'VramBudgetError';
    this.requiredMB = requiredMB;
    this.availableMB = availableMB;
  }
}

class InvalidSlotConfigError extends Error {
  constructor(field, reason) {
    super(`Invalid slot config: ${field} - ${reason}`);
    this.name = 'InvalidSlotConfigError';
    this.field = field;
    this.reason = reason;
  }
}

// ============================================================================
// Exports
// ============================================================================

// Export the pure selectSlot function for standalone use (Req 3.8)
const { selectSlot } = require('./slot-selector');

module.exports = {
  SlotManager,
  SlotBusyError,
  SlotNotFoundError,
  VramBudgetError,
  InvalidSlotConfigError,
  selectSlot,
  validateSlotConfig,
  _buildChildEnv,
};
