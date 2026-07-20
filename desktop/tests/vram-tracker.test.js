/* eslint-env node */
const { describe, it } = require('mocha');
const { expect } = require('chai');
const { VramTracker, OS_OVERHEAD_MB } = require('../vram-tracker');

describe('vram-tracker', () => {
  function createMockBudgetManager(detected, totalMB) {
    return {
      detect: async () => ({
        detected,
        totalMB,
        reservedMB: OS_OVERHEAD_MB,
        gpuCount: detected ? 1 : 0,
        physicalCores: 4,
      }),
      estimateRequiredMB: () => 1024,
    };
  }

  describe('init', () => {
    it('should set detected=true when budget manager detects GPU', async () => {
      const manager = createMockBudgetManager(true, 8192);
      const tracker = new VramTracker(manager);
      await tracker.init();
      expect(tracker.detected).to.be.true;
      expect(tracker.totalMB).to.equal(8192);
    });

    it('should set detected=false when budget manager fails detection', async () => {
      const manager = createMockBudgetManager(false, 0);
      const tracker = new VramTracker(manager);
      await tracker.init();
      expect(tracker.detected).to.be.false;
    });

    it('should set detected=false when no budget manager is provided', async () => {
      const tracker = new VramTracker(null);
      await tracker.init();
      expect(tracker.detected).to.be.false;
    });
  });

  describe('registerRunner / deregisterRunner', () => {
    it('should register and deregister allocations', () => {
      const tracker = new VramTracker(null);
      tracker.registerRunner('model-a.gguf', 1024);
      expect(tracker.getTotalAllocated()).to.equal(1024);

      tracker.registerRunner('model-b.gguf', 2048);
      expect(tracker.getTotalAllocated()).to.equal(3072);

      tracker.deregisterRunner('model-a.gguf');
      expect(tracker.getTotalAllocated()).to.equal(2048);
    });

    it('should throw on invalid modelPath', () => {
      const tracker = new VramTracker(null);
      expect(() => tracker.registerRunner(null, 1024)).to.throw('Invalid modelPath');
      expect(() => tracker.registerRunner('', 1024)).to.throw('Invalid modelPath');
    });

    it('should throw on invalid VRAM allocation', () => {
      const tracker = new VramTracker(null);
      expect(() => tracker.registerRunner('a.gguf', -1)).to.throw('Invalid VRAM allocation');
      expect(() => tracker.registerRunner('a.gguf', NaN)).to.throw('Invalid VRAM allocation');
    });
  });

  describe('getAvailable', () => {
    it('should return Infinity when detection failed', () => {
      const tracker = new VramTracker(null);
      tracker.detected = false;
      expect(tracker.getAvailable()).to.equal(Infinity);
    });

    it('should compute conservative estimate using min(predicted, gpuReported)', () => {
      const manager = createMockBudgetManager(true, 10000);
      const tracker = new VramTracker(manager, {
        gpuFreeQuery: () => 5000,
      });
      tracker.totalMB = 10000;
      tracker.detected = true;
      tracker.registerRunner('model-a.gguf', 2000);

      const predicted = 10000 - 2000 - OS_OVERHEAD_MB; // 7488
      const expected = Math.min(predicted, 5000);
      expect(tracker.getAvailable()).to.equal(expected);
    });

    it('should use predicted when gpuReported is Infinity', () => {
      const manager = createMockBudgetManager(true, 10000);
      const tracker = new VramTracker(manager, {
        gpuFreeQuery: () => Infinity,
      });
      tracker.totalMB = 10000;
      tracker.detected = true;
      tracker.registerRunner('model-a.gguf', 2000);

      const predicted = 10000 - 2000 - OS_OVERHEAD_MB;
      expect(tracker.getAvailable()).to.equal(predicted);
    });

    it('should never return negative available', () => {
      const manager = createMockBudgetManager(true, 1000);
      const tracker = new VramTracker(manager, {
        gpuFreeQuery: () => 100,
      });
      tracker.totalMB = 1000;
      tracker.detected = true;
      tracker.registerRunner('huge.gguf', 2000);

      expect(tracker.getAvailable()).to.equal(0);
    });
  });

  describe('canFit', () => {
    it('should return true when detection failed', () => {
      const tracker = new VramTracker(null);
      tracker.detected = false;
      expect(tracker.canFit(999999)).to.be.true;
    });

    it('should return true for negative or non-finite requiredMB', () => {
      const manager = createMockBudgetManager(true, 10000);
      const tracker = new VramTracker(manager);
      tracker.totalMB = 10000;
      tracker.detected = true;
      expect(tracker.canFit(-1)).to.be.true;
      expect(tracker.canFit(NaN)).to.be.true;
    });

    it('should return true when requiredMB fits within available', () => {
      const manager = createMockBudgetManager(true, 10000);
      const tracker = new VramTracker(manager, {
        gpuFreeQuery: () => 5000,
      });
      tracker.totalMB = 10000;
      tracker.detected = true;
      tracker.registerRunner('model-a.gguf', 2000);

      expect(tracker.canFit(4000)).to.be.true;
      expect(tracker.canFit(5001)).to.be.false;
    });
  });

  describe('getSnapshot', () => {
    it('should return a snapshot with expected shape', () => {
      const manager = createMockBudgetManager(true, 8192);
      const tracker = new VramTracker(manager, {
        gpuFreeQuery: () => 4000,
      });
      tracker.totalMB = 8192;
      tracker.detected = true;
      tracker.registerRunner('model-a.gguf', 1024);

      const snapshot = tracker.getSnapshot();
      expect(snapshot).to.have.property('totalMB', 8192);
      expect(snapshot).to.have.property('usedMB', 1024);
      expect(snapshot).to.have.property('availableMB');
      expect(snapshot).to.have.property('detected', true);
      expect(snapshot).to.have.property('allocations');
      expect(snapshot.allocations).to.deep.equal([
        { modelPath: 'model-a.gguf', mb: 1024 },
      ]);
    });
  });
});
