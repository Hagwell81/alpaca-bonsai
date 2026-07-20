/**
 * Scheduler
 *
 * Central coordinator for model lifecycle management.
 * Replaces the "kill-and-restart" pattern with persistent Runner processes,
 * zero-cost model reuse, intelligent eviction, and concurrent multi-model hosting.
 *
 * Requirements: 1–11
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { buildArgs } = require('./slot-args-builder');
const { createRunnerRef, STATES, transitionState } = require('./runner-ref');
const { rankEvictionCandidates } = require('./eviction-ranker');
const { pollHealthUntilReady } = require('./health-probe');
const { VramTracker } = require('./vram-tracker');
const { GGUFMetadataCache } = require('./gguf-metadata-cache');

const RESERVED_PORTS = [13434, 13435, 13436, 13437, 13438];

// ---------------------------------------------------------------------------
// Quick health check for reuse (must be fast)
// ---------------------------------------------------------------------------

function defaultQuickHealthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: 500 },
      (res) => {
        req.destroy();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

class Scheduler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.vramBudgetManager
   * @param {Object} [options.slotManager]
   * @param {Object} [options.modelLoader]
   * @param {Object} options.store - electron-store instance
   * @param {Object} [options.logger]
   */
  constructor({ vramBudgetManager, slotManager, modelLoader, store, logger = console, spawnFn, healthProbeFn, quickHealthCheckFn, getAdvancedArgsFn } = {}) {
    super();
    this.vramBudgetManager = vramBudgetManager || null;
    this.slotManager = slotManager || null;
    this.modelLoader = modelLoader || null;
    this.store = store || null;
    this.logger = logger;
    this.spawnFn = spawnFn || spawn;
    this.healthProbeFn = healthProbeFn || pollHealthUntilReady;
    this.quickHealthCheckFn = quickHealthCheckFn || defaultQuickHealthCheck;
    this.getAdvancedArgsFn = getAdvancedArgsFn || null;

    // Core state
    this.registry = new Map(); // modelPath -> RunnerRef
    this.loadQueue = [];
    this.loadingModels = new Set();
    this.pendingPromises = new Map(); // modelPath -> [{resolve, reject}]
    this.isShuttingDown = false;
    this.isActivated = false;
    this._isProcessingQueue = false;

    // Subsystems
    this.vramTracker = new VramTracker(vramBudgetManager);
    this.ggufCache = null;

    // Spawn context (set by integration layer before getRunner)
    this.spawnContext = {
      llamaServerBinary: 'llama-server',
      mmprojPath: null,
      extraArgv: [],
    };

    // Config (populated in init())
    this.config = this._defaultConfig();
  }

  _defaultConfig() {
    return {
      maxLoadedModels: 3,
      keepAliveDurationMs: 300000,
      healthProbeIntervalMs: 1000,
      healthProbeTimeoutMs: 90000,
      stopGraceMs: 15000,
      vramRecoveryTimeoutMs: 5000,
      vramRecoveryPollMs: 250,
      maxSpawnRetries: 3,
    };
  }

  _readConfigFromStore() {
    if (!this.store) return this._defaultConfig();
    return {
      maxLoadedModels: this.store.get('scheduler.maxLoadedModels', 3),
      keepAliveDurationMs: this.store.get('scheduler.keepAliveDurationMs', 300000),
      healthProbeIntervalMs: this.store.get('scheduler.healthProbeIntervalMs', 1000),
      healthProbeTimeoutMs: this.store.get('scheduler.healthProbeTimeoutMs', 90000),
      stopGraceMs: this.store.get('scheduler.stopGraceMs', 15000),
      vramRecoveryTimeoutMs: this.store.get('scheduler.vramRecoveryTimeoutMs', 5000),
      vramRecoveryPollMs: this.store.get('scheduler.vramRecoveryPollMs', 250),
      maxSpawnRetries: this.store.get('scheduler.maxSpawnRetries', 3),
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async init() {
    this.config = this._readConfigFromStore();
    await this.vramTracker.init();

    const cacheFilePath = this._resolveCachePath();
    this.ggufCache = new GGUFMetadataCache(cacheFilePath);
    await this.ggufCache.load();

    this.isActivated = true;
  }

  async activate() {
    if (this.isActivated) return;
    this.isActivated = true;

    const activeModel = this.store ? this.store.get('activeModelFilename') : null;
    if (activeModel) {
      try {
        await this.getRunner(activeModel);
      } catch (err) {
        this.logger.warn('Failed to activate default model:', err.message);
      }
    }
  }

  async shutdown() {
    this.isShuttingDown = true;

    // Clear all keep-alive timers
    for (const runner of this.registry.values()) {
      this._clearKeepAliveTimer(runner);
    }

    // Wait up to 5s for active requests to complete
    const waitDeadline = Date.now() + 5000;
    while (Date.now() < waitDeadline) {
      const active = Array.from(this.registry.values()).filter((r) => r.refCount > 0);
      if (active.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Terminate all runners
    const runners = Array.from(this.registry.values());
    await Promise.all(runners.map((r) => this._terminateRunner(r)));

    // Save cache
    if (this.ggufCache) {
      await this.ggufCache.save();
    }
  }

  /**
   * Register an externally spawned process with the scheduler.
   * Use when main.js spawns llama-server directly but wants the scheduler
   * to track it for lifecycle management.
   *
   * @param {string} modelPath
   * @param {import('child_process').ChildProcess} childProcess
   * @param {number} port
   * @param {Object} [options={}]
   * @param {string} [options.purpose='primary']
   * @param {number} [options.estimatedVramMB]
   * @returns {Promise<Object>} RunnerRef
   */
  async registerExternalRunner(modelPath, childProcess, port, options = {}) {
    const purpose = options.purpose || 'primary';
    const runnerRef = createRunnerRef({
      modelPath,
      port,
      process: childProcess,
      pid: childProcess.pid,
      state: STATES.LOADING,
      purpose,
      keepAliveDurationMs: this.config.keepAliveDurationMs,
    });

    this.emit('runner-state-changed', {
      modelPath,
      from: null,
      to: 'loading',
      port,
      pid: childProcess.pid,
      at: new Date().toISOString(),
    });

    // Capture stderr tail
    let stderrBuffer = Buffer.alloc(0);
    childProcess.stderr.on('data', (chunk) => {
      stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
    });

    // Unexpected exit handler
    childProcess.once('exit', (code, signal) => {
      runnerRef.stderrTail = stderrBuffer
        .toString('utf8', 0, Math.min(stderrBuffer.length, 4096));
      if (runnerRef.state !== 'evicting' && runnerRef.state !== 'terminated') {
        this.logger.error(
          `Runner ${modelPath} exited unexpectedly (code=${code}, signal=${signal})`
        );
        transitionState(runnerRef, 'terminated');
        const current = this.registry.get(modelPath);
        if (current === runnerRef) {
          this.registry.delete(modelPath);
          this.vramTracker.deregisterRunner(modelPath);
          this.emit('vram-updated', this.vramTracker.getSnapshot());
        }
      }
    });

    // Health probe to confirm readiness
    const healthy = await this.healthProbeFn(port, {
      intervalMs: this.config.healthProbeIntervalMs,
      timeoutMs: this.config.healthProbeTimeoutMs,
      onProgress: (elapsedMs) => {
        this.emit('runner-progress', { modelPath, elapsedMs, state: 'loading' });
      },
    });

    if (!healthy) {
      throw new Error(
        `Health probe failed for externally registered runner ${modelPath} on port ${port}`
      );
    }

    // Estimate VRAM
    const metadata = await this.ggufCache.getMetadata(modelPath).catch(() => ({}));
    const requiredMB = options.estimatedVramMB ?? this._estimateVram(modelPath, metadata, purpose);
    runnerRef.estimatedVramMB = requiredMB;

    // Register
    this.registry.set(modelPath, runnerRef);
    this.vramTracker.registerRunner(modelPath, requiredMB);

    transitionState(runnerRef, STATES.READY);
    runnerRef.loadedAt = Date.now();

    this.emit('runner-state-changed', {
      modelPath,
      from: 'loading',
      to: 'ready',
      port,
      pid: runnerRef.pid,
      at: new Date().toISOString(),
    });
    this.emit('vram-updated', this.vramTracker.getSnapshot());

    return runnerRef;
  }

  /**
   * Public API to terminate a specific runner.
   * @param {string} modelPath
   */
  async terminateRunner(modelPath) {
    const normalizedPath = path.resolve(modelPath);
    const runnerRef = this.registry.get(normalizedPath);
    if (runnerRef) {
      await this._terminateRunner(runnerRef);
    }
  }

  // ==========================================================================
  // Core API
  // ==========================================================================

  /**
   * Get or load a runner for the given model.
   * @param {string} modelPath
   * @returns {Promise<Object>} RunnerRef
   */
  async getRunner(modelPath) {
    if (this.isShuttingDown) {
      throw new Error('Scheduler is shutting down');
    }

    const normalizedPath = path.resolve(modelPath);

    // Already loaded?
    const existing = this.registry.get(normalizedPath);
    if (existing && ['ready', 'idle', 'serving'].includes(existing.state)) {
      const healthy = await this.quickHealthCheckFn(existing.port);
      if (healthy) {
        this._acquireRunner(existing);
        return existing;
      }
      // Health probe failed — respawn
      this.registry.delete(normalizedPath);
      this.vramTracker.deregisterRunner(normalizedPath);
    }

    // Already loading?
    if (this.loadingModels.has(normalizedPath)) {
      return new Promise((resolve, reject) => {
        if (!this.pendingPromises.has(normalizedPath)) {
          this.pendingPromises.set(normalizedPath, []);
        }
        this.pendingPromises.get(normalizedPath).push({ resolve, reject });
      });
    }

    // Need to load
    return new Promise((resolve, reject) => {
      if (!this.pendingPromises.has(normalizedPath)) {
        this.pendingPromises.set(normalizedPath, []);
      }
      this.pendingPromises.get(normalizedPath).push({ resolve, reject });
      this._enqueueLoad(normalizedPath, 'primary');
    });
  }

  /**
   * Release a runner after request completion.
   * @param {string} modelPath
   */
  releaseRunner(modelPath) {
    const normalizedPath = path.resolve(modelPath);
    const runnerRef = this.registry.get(normalizedPath);
    if (runnerRef) {
      this._releaseRunner(runnerRef);
    }
  }

  /**
   * Switch to a different model (UI-driven).
   * @param {string} modelPath
   * @returns {Promise<Object>} RunnerRef for the new model
   */
  async switchModel(modelPath) {
    if (this.isShuttingDown) {
      throw new Error('Scheduler is shutting down');
    }
    const runnerRef = await this.getRunner(modelPath);
    if (this.store) {
      this.store.set('activeModelFilename', modelPath);
    }
    return runnerRef;
  }

  /**
   * Pre-load models for comparison/parallel mode.
   * @param {string[]} modelPaths
   * @returns {Promise<Object[]>}
   */
  async preloadModels(modelPaths) {
    return Promise.allSettled(modelPaths.map((p) => this.getRunner(p)));
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  async updateConfig(partial) {
    for (const [key, value] of Object.entries(partial)) {
      if (this.config[key] === undefined) continue;
      if (this.config[key] !== value) {
        const oldValue = this.config[key];
        this.config[key] = value;
        if (this.store) {
          this.store.set(`scheduler.${key}`, value);
        }
        this.emit('config-changed', { key, oldValue, newValue: value });

        if (key === 'maxLoadedModels') {
          await this._evictExcessRunners();
        } else if (key === 'keepAliveDurationMs') {
          this._resetAllIdleTimers();
        }
      }
    }
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  getLoadedModels() {
    return Array.from(this.registry.values())
      .filter((r) => r.state !== 'terminated')
      .map((r) => ({
        modelPath: r.modelPath,
        state: r.state,
        port: r.port,
        vramMB: r.estimatedVramMB,
        lastUsed: r.lastUsedAt,
      }));
  }

  getActiveAllocationsMB() {
    if (this.vramTracker && typeof this.vramTracker.getAllocationsMB === 'function') {
      return this.vramTracker.getAllocationsMB();
    }
    return [];
  }

  getRunnerState(modelPath) {
    const normalizedPath = path.resolve(modelPath);
    const runner = this.registry.get(normalizedPath);
    return runner ? runner.state : null;
  }

  // ==========================================================================
  // Load queue (serialized loads)
  // ==========================================================================

  _enqueueLoad(modelPath, purpose) {
    if (!this.loadQueue.some((item) => item.modelPath === modelPath)) {
      this.loadQueue.push({ modelPath, purpose });
    }
    this._processLoadQueue();
  }

  async _processLoadQueue() {
    if (this._isProcessingQueue || this.isShuttingDown) return;
    this._isProcessingQueue = true;

    while (this.loadQueue.length > 0 && !this.isShuttingDown) {
      const { modelPath, purpose } = this.loadQueue.shift();

      if (this.loadingModels.has(modelPath)) continue;
      if (this.registry.has(modelPath)) {
        // Already loaded by another path
        this._resolvePending(modelPath, this.registry.get(modelPath));
        continue;
      }

      this.loadingModels.add(modelPath);

      try {
        const runnerRef = await this._doLoad(modelPath, purpose);
        this._resolvePending(modelPath, runnerRef);
      } catch (err) {
        this._rejectPending(modelPath, err);
      } finally {
        this.loadingModels.delete(modelPath);
      }
    }

    this._isProcessingQueue = false;
  }

  _resolvePending(modelPath, runnerRef) {
    const promises = this.pendingPromises.get(modelPath) || [];
    this.pendingPromises.delete(modelPath);
    for (const { resolve } of promises) {
      this._acquireRunner(runnerRef);
      resolve(runnerRef);
    }
  }

  _rejectPending(modelPath, err) {
    const promises = this.pendingPromises.get(modelPath) || [];
    this.pendingPromises.delete(modelPath);
    for (const { reject } of promises) {
      reject(err);
    }
  }

  // ==========================================================================
  // Load execution
  // ==========================================================================

  async _doLoad(modelPath, purpose) {
    // Get cached metadata
    const metadata = await this.ggufCache.getMetadata(modelPath);

    // Estimate VRAM
    const requiredMB = this._estimateVram(modelPath, metadata, purpose);

    // Enforce maxLoadedModels
    const activeRunners = Array.from(this.registry.values()).filter(
      (r) => r.state !== 'terminated' && r.state !== 'evicting'
    );
    if (activeRunners.length >= this.config.maxLoadedModels) {
      const candidates = rankEvictionCandidates(activeRunners);
      if (candidates.length > 0) {
        await this._terminateRunner(candidates[0]);
        await this._waitForVramRecovery(candidates[0]);
      }
    }

    // Ensure VRAM availability
    if (!this.vramTracker.canFit(requiredMB)) {
      await this._evictForSpace(requiredMB);
    }
    if (!this.vramTracker.canFit(requiredMB)) {
      throw new Error(
        `Insufficient VRAM to load ${modelPath} (needs ${requiredMB} MB)`
      );
    }

    // Acquire port
    let port = this._getNextAvailablePort();
    if (port === null) {
      const candidates = rankEvictionCandidates(activeRunners);
      if (candidates.length > 0) {
        await this._terminateRunner(candidates[0]);
        await this._waitForVramRecovery(candidates[0]);
        port = this._getNextAvailablePort();
      }
    }
    if (port === null) {
      throw new Error('No available ports in reserved range');
    }

    // Spawn with retry
    const runnerRef = await this._spawnRunnerWithRetry(modelPath, port, purpose);

    // Register
    runnerRef.estimatedVramMB = requiredMB;
    this.registry.set(modelPath, runnerRef);
    this.vramTracker.registerRunner(modelPath, requiredMB);
    this.emit('vram-updated', this.vramTracker.getSnapshot());

    return runnerRef;
  }

  _estimateVram(modelPath, metadata, purpose) {
    const modelFilename = path.basename(modelPath);
    const advancedArgs = this._getAdvancedArgs(purpose, modelFilename);
    const estimateConfig = {
      modelFileSizeMB: metadata.fileSizeMB || 0,
      totalLayers: metadata.layerCount || 0,
      ctxSize: advancedArgs.ctxSize,
      typeK: advancedArgs.typeK,
      typeV: advancedArgs.typeV,
      purpose,
      nGpuLayers: advancedArgs.nGpuLayers,
    };

    if (this.vramBudgetManager && typeof this.vramBudgetManager.estimateRequiredMB === 'function') {
      return this.vramBudgetManager.estimateRequiredMB(estimateConfig);
    }

    // Fallback rough estimate
    return (metadata.fileSizeMB || 0) + 512;
  }

  // ==========================================================================
  // Port allocation
  // ==========================================================================

  _getNextAvailablePort() {
    const usedPorts = new Set();
    for (const runner of this.registry.values()) {
      if (runner.state !== 'terminated' && runner.port !== null) {
        usedPorts.add(runner.port);
      }
    }
    for (const port of RESERVED_PORTS) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  // ==========================================================================
  // Spawn
  // ==========================================================================

  async _spawnRunnerWithRetry(modelPath, port, purpose) {
    const delays = [1000, 2000, 4000];
    let attemptPort = port;
    let lastErr = null;

    for (let attempt = 0; attempt < this.config.maxSpawnRetries; attempt++) {
      try {
        return await this._spawnRunner(modelPath, attemptPort, purpose);
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Spawn attempt ${attempt + 1} failed for ${modelPath}:`,
          err.message
        );

        if (attempt === this.config.maxSpawnRetries - 1) break;

        await new Promise((r) => setTimeout(r, delays[attempt]));

        const nextPort = this._getNextAvailablePort();
        if (nextPort !== null && nextPort !== attemptPort) {
          attemptPort = nextPort;
        }
      }
    }

    throw new Error(
      `Failed to spawn runner for ${modelPath} after ${this.config.maxSpawnRetries} attempts: ${lastErr?.message}`
    );
  }

  async _spawnRunner(modelPath, port, purpose) {
    const runnerRef = createRunnerRef({
      modelPath,
      port,
      purpose,
      state: STATES.SPAWNING,
      keepAliveDurationMs: this.config.keepAliveDurationMs,
    });

    this.emit('runner-state-changed', {
      modelPath,
      from: null,
      to: 'spawning',
      port,
      at: new Date().toISOString(),
    });

    // Build argv
    const modelFilename = path.basename(modelPath);
    const slotConfig = {
      modelPath,
      mmprojPath: this.spawnContext.mmprojPath,
      port,
      purpose,
      advancedArgs: this._getAdvancedArgs(purpose, modelFilename),
    };
    const argv = buildArgs(slotConfig);
    if (Array.isArray(this.spawnContext.extraArgv) && this.spawnContext.extraArgv.length > 0) {
      argv.push(...this.spawnContext.extraArgv);
    }

    const binary = this.spawnContext.llamaServerBinary || 'llama-server';
    const child = this.spawnFn(binary, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    runnerRef.process = child;
    runnerRef.pid = child.pid;

    // Capture stderr tail
    let stderrBuffer = Buffer.alloc(0);
    child.stderr.on('data', (chunk) => {
      stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
    });

    // Unexpected exit handler
    child.once('exit', (code, signal) => {
      runnerRef.stderrTail = stderrBuffer
        .toString('utf8', 0, Math.min(stderrBuffer.length, 4096));
      if (runnerRef.state !== 'evicting' && runnerRef.state !== 'terminated') {
        this.logger.error(
          `Runner ${modelPath} exited unexpectedly (code=${code}, signal=${signal})`
        );
        transitionState(runnerRef, 'terminated');
        const current = this.registry.get(modelPath);
        if (current === runnerRef) {
          this.registry.delete(modelPath);
          this.vramTracker.deregisterRunner(modelPath);
          this.emit('vram-updated', this.vramTracker.getSnapshot());
        }
      }
    });

    transitionState(runnerRef, STATES.LOADING);
    this.emit('runner-state-changed', {
      modelPath,
      from: 'spawning',
      to: 'loading',
      port,
      pid: runnerRef.pid,
      at: new Date().toISOString(),
    });

    const healthy = await this.healthProbeFn(port, {
      intervalMs: this.config.healthProbeIntervalMs,
      timeoutMs: this.config.healthProbeTimeoutMs,
      onProgress: (elapsedMs) => {
        this.emit('runner-progress', { modelPath, elapsedMs, state: 'loading' });
      },
    });

    if (!healthy) {
      child.kill('SIGKILL');
      throw new Error(
        `Health probe failed for ${modelPath} on port ${port}. stderr: ${runnerRef.stderrTail}`
      );
    }

    transitionState(runnerRef, STATES.READY);
    runnerRef.loadedAt = Date.now();
    this.emit('runner-state-changed', {
      modelPath,
      from: 'loading',
      to: 'ready',
      port,
      pid: runnerRef.pid,
      at: new Date().toISOString(),
    });

    return runnerRef;
  }

  setSpawnContext({ llamaServerBinary, mmprojPath, extraArgv }) {
    if (llamaServerBinary !== undefined) {
      this.spawnContext.llamaServerBinary = llamaServerBinary;
    }
    if (mmprojPath !== undefined) {
      this.spawnContext.mmprojPath = mmprojPath;
    }
    if (extraArgv !== undefined) {
      this.spawnContext.extraArgv = extraArgv;
    }
  }

  _getAdvancedArgs(purpose, modelFilename) {
    // If integration layer provided a custom getter (e.g., via modelConfigStore), use it
    if (this.getAdvancedArgsFn && typeof this.getAdvancedArgsFn === 'function') {
      try {
        const args = this.getAdvancedArgsFn(modelFilename);
        if (args && typeof args === 'object') return args;
      } catch (_e) {
        // fall through to defaults
      }
    }
    // Defaults
    return {
      ctxSize: 4096,
      batchSize: 512,
      ubatchSize: 512,
      parallel: 1,
      threads: 4,
      nGpuLayers: -1,
      flashAttn: false,
      mmap: true,
      mlock: false,
      contBatching: true,
      typeK: 'f16',
      typeV: 'f16',
      nCpuMoe: 0,
      tensorSplit: [],
      mainGpu: -1,
      splitMode: 'none',
      rpc: [],
    };
  }

  // ==========================================================================
  // Eviction
  // ==========================================================================

  async _evictForSpace(requiredMB) {
    let iterations = 0;
    const maxIterations = 5;

    while (!this.vramTracker.canFit(requiredMB) && iterations < maxIterations) {
      const activeRunners = Array.from(this.registry.values()).filter(
        (r) => r.state !== 'terminated' && r.state !== 'evicting'
      );
      const candidates = rankEvictionCandidates(activeRunners);
      if (candidates.length === 0) break;

      await this._terminateRunner(candidates[0]);
      await this._waitForVramRecovery(candidates[0]);
      iterations++;
    }
  }

  async _evictExcessRunners() {
    const activeRunners = Array.from(this.registry.values()).filter(
      (r) => r.state !== 'terminated' && r.state !== 'evicting'
    );
    const excess = activeRunners.length - this.config.maxLoadedModels;
    if (excess > 0) {
      const candidates = rankEvictionCandidates(activeRunners);
      for (let i = 0; i < Math.min(excess, candidates.length); i++) {
        await this._terminateRunner(candidates[i]);
      }
    }
  }

  async _terminateRunner(runnerRef) {
    if (runnerRef.state === 'terminated' || runnerRef.state === 'evicting') return;

    const fromState = runnerRef.state;
    transitionState(runnerRef, 'evicting');
    this._clearKeepAliveTimer(runnerRef);

    this.emit('runner-state-changed', {
      modelPath: runnerRef.modelPath,
      from: fromState,
      to: 'evicting',
      port: runnerRef.port,
      pid: runnerRef.pid,
      at: new Date().toISOString(),
    });

    const child = runnerRef.process;
    if (child && !child.killed) {
      child.kill('SIGTERM');

      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), this.config.stopGraceMs);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
        if (child.exitCode !== null || child.signalCode !== null) {
          clearTimeout(timer);
          resolve(true);
        }
      });

      if (!exited) {
        try {
          child.kill('SIGKILL');
        } catch (_e) {
          // Already dead
        }
      }
    }

    this.vramTracker.deregisterRunner(runnerRef.modelPath);
    this.registry.delete(runnerRef.modelPath);

    transitionState(runnerRef, 'terminated');
    this.emit('runner-state-changed', {
      modelPath: runnerRef.modelPath,
      from: 'evicting',
      to: 'terminated',
      port: runnerRef.port,
      pid: runnerRef.pid,
      at: new Date().toISOString(),
    });
    this.emit('vram-updated', this.vramTracker.getSnapshot());
  }

  async _waitForVramRecovery(runnerRef) {
    const expectedMB = runnerRef.estimatedVramMB;
    const before = this.vramTracker.getGpuReportedFree();

    if (!Number.isFinite(before)) {
      await new Promise((r) => setTimeout(r, this.config.vramRecoveryPollMs));
      return;
    }

    const deadline = Date.now() + this.config.vramRecoveryTimeoutMs;
    const target = before + expectedMB * 0.75;

    while (Date.now() < deadline) {
      const current = this.vramTracker.getGpuReportedFree();
      if (current >= target) return;
      await new Promise((r) => setTimeout(r, this.config.vramRecoveryPollMs));
    }
  }

  // ==========================================================================
  // Keep-alive timers
  // ==========================================================================

  _startKeepAliveTimer(runnerRef) {
    this._clearKeepAliveTimer(runnerRef);
    if (!Number.isFinite(this.config.keepAliveDurationMs)) {
      return;
    }
    runnerRef.keepAliveTimer = setTimeout(() => {
      this._onKeepAliveExpired(runnerRef);
    }, this.config.keepAliveDurationMs);
  }

  _clearKeepAliveTimer(runnerRef) {
    if (runnerRef.keepAliveTimer) {
      clearTimeout(runnerRef.keepAliveTimer);
      runnerRef.keepAliveTimer = null;
    }
  }

  async _onKeepAliveExpired(runnerRef) {
    if (runnerRef.refCount > 0) return;
    await this._terminateRunner(runnerRef);
  }

  _resetAllIdleTimers() {
    for (const runner of this.registry.values()) {
      if (runner.state === 'idle') {
        this._clearKeepAliveTimer(runner);
        this._startKeepAliveTimer(runner);
      }
    }
  }

  // ==========================================================================
  // Runner lifecycle helpers
  // ==========================================================================

  _acquireRunner(runnerRef) {
    runnerRef.refCount++;
    runnerRef.lastUsedAt = Date.now();
    this._clearKeepAliveTimer(runnerRef);

    if (runnerRef.state === 'ready' || runnerRef.state === 'idle') {
      const from = runnerRef.state;
      transitionState(runnerRef, 'serving');
      this.emit('runner-state-changed', {
        modelPath: runnerRef.modelPath,
        from,
        to: 'serving',
        port: runnerRef.port,
        pid: runnerRef.pid,
        at: new Date().toISOString(),
      });
    }
  }

  _releaseRunner(runnerRef) {
    runnerRef.refCount = Math.max(0, runnerRef.refCount - 1);
    if (runnerRef.refCount === 0 && runnerRef.state === 'serving') {
      transitionState(runnerRef, 'idle');
      this.emit('runner-state-changed', {
        modelPath: runnerRef.modelPath,
        from: 'serving',
        to: 'idle',
        port: runnerRef.port,
        pid: runnerRef.pid,
        at: new Date().toISOString(),
      });
      this._startKeepAliveTimer(runnerRef);
    }
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  _resolveCachePath() {
    if (this.store && this.store.path) {
      const storeDir = path.dirname(this.store.path);
      return path.join(storeDir, 'gguf-metadata-cache.json');
    }
    return path.join(require('os').tmpdir(), 'gguf-metadata-cache.json');
  }
}

module.exports = { Scheduler, RESERVED_PORTS };
