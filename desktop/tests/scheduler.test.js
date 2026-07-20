/* eslint-env node */
const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Scheduler, RESERVED_PORTS } = require('../scheduler');

describe('scheduler', () => {
  let scheduler;
  let mockStore;
  let mockBudgetManager;
  let tmpDir;
  let events;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'scheduler-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    mockStore = {
      data: {},
      get(key, defaultValue) {
        return key in this.data ? this.data[key] : defaultValue;
      },
      set(key, value) {
        this.data[key] = value;
      },
      path: path.join(tmpDir, 'store.json'),
    };

    mockBudgetManager = {
      detect: async () => ({
        detected: true,
        totalMB: 8192,
        reservedMB: 512,
        gpuCount: 1,
        physicalCores: 4,
      }),
      estimateRequiredMB: (config) => {
        return (config.modelFileSizeMB || 0) + 256;
      },
    };

    events = [];
  });

  afterEach(async () => {
    if (scheduler) {
      try {
        await scheduler.shutdown();
      } catch (_e) {
        // ignore
      }
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createMockSpawn(options = {}) {
    const { failAttempts = 0, exitAfterMs = null } = options;
    let attempt = 0;
    return (cmd, argv, opts) => {
      attempt++;
      const child = new EventEmitter();
      child.pid = 12340 + attempt;
      child.killed = false;
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.kill = (signal) => {
        child.killed = true;
        setTimeout(() => {
          child.emit('exit', signal === 'SIGKILL' ? 1 : 0, signal);
        }, 5);
      };
      child.stdio = ['pipe', 'pipe', 'pipe'];

      if (exitAfterMs) {
        setTimeout(() => {
          if (!child.killed) {
            child.emit('exit', 1, null);
          }
        }, exitAfterMs);
      }

      return child;
    };
  }

  function createMockHealthProbe(options = {}) {
    const { failFirst = 0 } = options;
    let callCount = 0;
    return async (port, opts) => {
      callCount++;
      if (opts.onProgress) opts.onProgress(0);
      if (callCount <= failFirst) {
        return false;
      }
      return true;
    };
  }

  function createScheduler(options = {}) {
    const s = new Scheduler({
      vramBudgetManager: mockBudgetManager,
      store: mockStore,
      logger: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
      spawnFn: options.spawnFn || createMockSpawn(),
      healthProbeFn: options.healthProbeFn || createMockHealthProbe(),
      quickHealthCheckFn: options.quickHealthCheckFn || (() => Promise.resolve(true)),
    });
    s.on('runner-state-changed', (e) => events.push({ type: 'state', ...e }));
    s.on('runner-progress', (e) => events.push({ type: 'progress', ...e }));
    s.on('vram-updated', (e) => events.push({ type: 'vram', ...e }));
    s.on('config-changed', (e) => events.push({ type: 'config', ...e }));
    return s;
  }

  function createFakeModelFile(name) {
    const filePath = path.join(tmpDir, name);
    // Write a fake file that is NOT a valid GGUF so parser falls back
    fs.writeFileSync(filePath, 'this-is-not-gguf-data-at-all');
    return filePath;
  }

  describe('init', () => {
    it('should read config from store', async () => {
      mockStore.set('scheduler.maxLoadedModels', 2);
      mockStore.set('scheduler.keepAliveDurationMs', 60000);
      scheduler = createScheduler();
      await scheduler.init();
      expect(scheduler.config.maxLoadedModels).to.equal(2);
      expect(scheduler.config.keepAliveDurationMs).to.equal(60000);
    });

    it('should init vram tracker', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      expect(scheduler.vramTracker.detected).to.be.true;
      expect(scheduler.vramTracker.totalMB).to.equal(8192);
    });
  });

  describe('getRunner', () => {
    it('should load and return a runner for new model', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('model-a.gguf');

      const runner = await scheduler.getRunner(modelFile);
      expect(runner).to.exist;
      expect(runner.modelPath).to.equal(modelFile);
      expect(runner.state).to.equal('serving');
      expect(runner.refCount).to.equal(1);
      expect(RESERVED_PORTS).to.include(runner.port);
    });

    it('should reuse an existing runner without re-spawning', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('model-b.gguf');

      const runner1 = await scheduler.getRunner(modelFile);
      const runner2 = await scheduler.getRunner(modelFile);

      expect(runner1).to.equal(runner2);
      expect(runner1.refCount).to.equal(2);
    });

    it('should reject when shutting down', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      scheduler.isShuttingDown = true;

      try {
        await scheduler.getRunner(createFakeModelFile('x.gguf'));
        expect.fail('Expected error');
      } catch (err) {
        expect(err.message).to.include('shutting down');
      }
    });

    it('should emit state transition events', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('model-c.gguf');

      await scheduler.getRunner(modelFile);

      const stateEvents = events.filter((e) => e.type === 'state');
      expect(stateEvents.some((e) => e.to === 'spawning')).to.be.true;
      expect(stateEvents.some((e) => e.to === 'loading')).to.be.true;
      expect(stateEvents.some((e) => e.to === 'ready')).to.be.true;
      expect(stateEvents.some((e) => e.to === 'serving')).to.be.true;
    });
  });

  describe('releaseRunner', () => {
    it('should decrement refCount and transition to idle', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('model-d.gguf');

      const runner = await scheduler.getRunner(modelFile);
      expect(runner.refCount).to.equal(1);
      expect(runner.state).to.equal('serving');

      scheduler.releaseRunner(modelFile);
      expect(runner.refCount).to.equal(0);
      expect(runner.state).to.equal('idle');
    });

    it('should emit runner-state-changed on release', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('model-e.gguf');

      const runner = await scheduler.getRunner(modelFile);
      events.length = 0;
      scheduler.releaseRunner(modelFile);

      const stateEvents = events.filter((e) => e.type === 'state');
      expect(stateEvents.some((e) => e.from === 'serving' && e.to === 'idle')).to.be.true;
    });
  });

  describe('keep-alive timer', () => {
    it('should terminate runner after keepAliveDuration expires', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      await scheduler.updateConfig({ keepAliveDurationMs: 100 });
      const modelFile = createFakeModelFile('model-f.gguf');

      const runner = await scheduler.getRunner(modelFile);
      scheduler.releaseRunner(modelFile);

      expect(runner.state).to.equal('idle');
      await new Promise((r) => setTimeout(r, 250));
      expect(runner.state).to.equal('terminated');
    });

    it('should not expire when keepAliveDuration is Infinity', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      await scheduler.updateConfig({ keepAliveDurationMs: Infinity });
      const modelFile = createFakeModelFile('model-g.gguf');

      const runner = await scheduler.getRunner(modelFile);
      scheduler.releaseRunner(modelFile);

      await new Promise((r) => setTimeout(r, 100));
      expect(runner.state).to.equal('idle');
    });
  });

  describe('maxLoadedModels enforcement', () => {
    it('should evict LRU runner when maxLoadedModels exceeded', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      await scheduler.updateConfig({ maxLoadedModels: 2 });

      const modelA = createFakeModelFile('a.gguf');
      const modelB = createFakeModelFile('b.gguf');
      const modelC = createFakeModelFile('c.gguf');

      const rA = await scheduler.getRunner(modelA);
      scheduler.releaseRunner(modelA);

      const rB = await scheduler.getRunner(modelB);
      scheduler.releaseRunner(modelB);

      // Now load C; A should be evicted because it's the oldest idle
      const rC = await scheduler.getRunner(modelC);

      expect(rA.state).to.equal('terminated');
      expect(rB.state).to.equal('idle');
      expect(rC.state).to.equal('serving');
    });

    it('should evict excess immediately when maxLoadedModels decreased', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      await scheduler.updateConfig({ maxLoadedModels: 3 });

      const modelA = createFakeModelFile('a2.gguf');
      const modelB = createFakeModelFile('b2.gguf');
      const modelC = createFakeModelFile('c2.gguf');

      await scheduler.getRunner(modelA);
      scheduler.releaseRunner(modelA);
      await scheduler.getRunner(modelB);
      scheduler.releaseRunner(modelB);
      await scheduler.getRunner(modelC);
      scheduler.releaseRunner(modelC);

      expect(scheduler.getLoadedModels().length).to.equal(3);

      await scheduler.updateConfig({ maxLoadedModels: 1 });
      const loaded = scheduler.getLoadedModels();
      expect(loaded.length).to.be.at.most(1);
    });
  });

  describe('switchModel', () => {
    it('should load new model and update activeModelFilename', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('switch-target.gguf');

      const runner = await scheduler.switchModel(modelFile);
      expect(runner).to.exist;
      expect(mockStore.get('activeModelFilename')).to.equal(modelFile);
    });
  });

  describe('shutdown', () => {
    it('should terminate all runners', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelA = createFakeModelFile('shutdown-a.gguf');
      const modelB = createFakeModelFile('shutdown-b.gguf');

      const rA = await scheduler.getRunner(modelA);
      const rB = await scheduler.getRunner(modelB);

      await scheduler.shutdown();
      expect(rA.state).to.equal('terminated');
      expect(rB.state).to.equal('terminated');
      expect(scheduler.isShuttingDown).to.be.true;
    });
  });

  describe('updateConfig', () => {
    it('should reset idle timers when keepAliveDuration changes', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      await scheduler.updateConfig({ keepAliveDurationMs: 5000 });
      const modelFile = createFakeModelFile('config-test.gguf');

      const runner = await scheduler.getRunner(modelFile);
      scheduler.releaseRunner(modelFile);
      expect(runner.keepAliveTimer).to.not.be.null;

      await scheduler.updateConfig({ keepAliveDurationMs: 10000 });
      expect(runner.keepAliveTimer).to.not.be.null;
    });
  });

  describe('VRAM eviction', () => {
    it('should evict runners when VRAM budget exceeded', async () => {
      const smallBudgetManager = {
        detect: async () => ({ detected: true, totalMB: 1000, reservedMB: 512, gpuCount: 1, physicalCores: 4 }),
        estimateRequiredMB: (config) => 400,
      };

      scheduler = new Scheduler({
        vramBudgetManager: smallBudgetManager,
        store: mockStore,
        logger: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
        spawnFn: createMockSpawn(),
        healthProbeFn: createMockHealthProbe(),
        quickHealthCheckFn: () => Promise.resolve(true),
      });
      await scheduler.init();

      const modelA = createFakeModelFile('vram-a.gguf');
      const modelB = createFakeModelFile('vram-b.gguf');
      const modelC = createFakeModelFile('vram-c.gguf');

      const rA = await scheduler.getRunner(modelA);
      scheduler.releaseRunner(modelA);

      const rB = await scheduler.getRunner(modelB);
      scheduler.releaseRunner(modelB);

      // Each model needs 400MB, total = 800MB, available ~488MB. Can fit 1.
      const rC = await scheduler.getRunner(modelC);
      // A should have been evicted to make room
      expect(rA.state === 'terminated' || rB.state === 'terminated').to.be.true;
      expect(rC.state).to.equal('serving');
    });
  });

  describe('getLoadedModels / getRunnerState', () => {
    it('should return metadata for loaded runners', async () => {
      scheduler = createScheduler();
      await scheduler.init();
      const modelFile = createFakeModelFile('query.gguf');

      await scheduler.getRunner(modelFile);
      const loaded = scheduler.getLoadedModels();
      expect(loaded).to.have.lengthOf(1);
      expect(loaded[0]).to.have.property('modelPath', modelFile);
      expect(loaded[0]).to.have.property('state');
      expect(loaded[0]).to.have.property('port');
      expect(loaded[0]).to.have.property('vramMB');

      expect(scheduler.getRunnerState(modelFile)).to.equal('serving');
      expect(scheduler.getRunnerState('/nonexistent.gguf')).to.be.null;
    });
  });

  describe('spawn retry', () => {
    it('should retry failed spawns up to maxSpawnRetries', async () => {
      let spawnCount = 0;
      const failingSpawn = (cmd, argv, opts) => {
        spawnCount++;
        const child = new EventEmitter();
        child.pid = 99990 + spawnCount;
        child.killed = false;
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stdin = new EventEmitter();
        child.kill = () => {
          child.killed = true;
        };
        child.stdio = ['pipe', 'pipe', 'pipe'];

        // Emit exit after a short delay to simulate immediate failure
        setTimeout(() => {
          if (!child.killed) child.emit('exit', 1, null);
        }, 5);
        return child;
      };

      scheduler = createScheduler({
        spawnFn: failingSpawn,
        healthProbeFn: async () => false,
      });
      await scheduler.updateConfig({ maxSpawnRetries: 2 });
      await scheduler.init();

      const modelFile = createFakeModelFile('retry.gguf');
      try {
        await scheduler.getRunner(modelFile);
        expect.fail('Expected spawn to fail');
      } catch (err) {
        expect(err.message).to.include('Failed to spawn runner');
        expect(spawnCount).to.equal(2);
      }
    });
  });
});
