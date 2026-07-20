/* eslint-env node */
/**
 * Integration test: real slot lifecycle against llama-server
 *
 * Verifies the real slot lifecycle (idle → starting → running → stopping → idle)
 * against an actual llama-server instance.
 *
 * Gated behind LLAMA_BIN env var. Run with:
 *   LLAMA_BIN=/path/to/llama-server mocha desktop/tests/integration/slot-start-real-binary.test.js --timeout 120000
 *
 * Requirements: 2 (Slot lifecycle), 14.1 (Chat template detection)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { SlotManager, SlotBusyError, SlotNotFoundError, VramBudgetError } = require('../../model-slot-manager');
const { VramBudgetManager } = require('../../vram-budget-manager');
const { ModelConfigStore } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

// Skip this test if LLAMA_BIN is not set
const LLAMA_BIN = process.env.LLAMA_BIN;
const skipTest = !LLAMA_BIN;

describe('Integration: Real Slot Lifecycle against llama-server', function () {
  this.timeout(120000); // 2 minutes for real binary startup

  if (skipTest) {
    it('SKIPPED: LLAMA_BIN env var not set', () => {
      console.log('To run this test, set LLAMA_BIN=/path/to/llama-server');
    });
    return;
  }

  let slotManager;
  let vramBudgetManager;
  let modelConfigStore;
  let fixtureModelPath;

  before(async function () {
    // Verify llama-server binary exists
    if (!fs.existsSync(LLAMA_BIN)) {
      this.skip();
      return;
    }

    // Initialize managers
    vramBudgetManager = new VramBudgetManager();
    await vramBudgetManager.detect();

    // Create a mock model config store (in-memory)
    modelConfigStore = {
      get: () => null,
      getOrDefault: () => DEFAULT_ADVANCED_ARGS,
      set: () => {},
      delete: () => {},
      reconcile: () => {},
      listAll: () => ({}),
    };

    slotManager = new SlotManager({
      vramBudgetManager,
      modelConfigStore,
      logger: console,
    });

    await slotManager.init();

    // Try to find a fixture model or use a minimal one
    // For this test, we'll use a very small model if available
    // The test will look for a model in common locations
    const possiblePaths = [
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.cache', 'huggingface', 'hub'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'models'),
      '/tmp/models',
      'C:\\models',
    ];

    fixtureModelPath = null;
    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.gguf'));
        if (files.length > 0) {
          fixtureModelPath = path.join(dir, files[0]);
          break;
        }
      }
    }

    if (!fixtureModelPath) {
      console.warn('No fixture GGUF model found. Test will be skipped.');
      this.skip();
    }
  });

  after(async function () {
    if (slotManager) {
      await slotManager.stopAll();
    }
  });

  it('should transition through idle → starting → running → stopping → idle', async function () {
    const slot0 = slotManager.getSlot(0);
    assert.strictEqual(slot0.status, 'idle', 'Slot 0 should start in idle state');

    // Collect all status change events
    const events = [];
    const eventListener = (event) => {
      events.push(event);
    };
    slotManager.on('slot-status-changed', eventListener);

    try {
      // Start the slot
      const slotConfig = {
        modelPath: fixtureModelPath,
        port: 13434,
        purpose: 'primary',
        advancedArgs: DEFAULT_ADVANCED_ARGS,
      };

      const startPromise = slotManager.startSlot(0, slotConfig);
      assert(startPromise instanceof Promise, 'startSlot should return a Promise');

      // Wait for the slot to reach running state (with timeout)
      const startedSlot = await Promise.race([
        startPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Slot start timeout after 60s')), 60000)
        ),
      ]);

      assert.strictEqual(startedSlot.status, 'running', 'Slot should be running after startSlot');
      assert.strictEqual(startedSlot.modelPath, fixtureModelPath, 'Slot should have modelPath set');
      assert.strictEqual(startedSlot.process !== null, true, 'Slot should have a child process');

      // Verify status change events so far
      const startEvents = events.filter((e) => e.slotId === 0);
      assert(startEvents.length >= 2, 'Should have at least idle→starting and starting→running events');
      assert.strictEqual(startEvents[0].from, 'idle', 'First transition should be from idle');
      assert.strictEqual(startEvents[0].to, 'starting', 'First transition should be to starting');
      assert.strictEqual(startEvents[startEvents.length - 1].to, 'running', 'Final transition should be to running');

      // Verify legal transitions
      for (const event of startEvents) {
        const legalTransitions = [
          ['idle', 'starting'],
          ['starting', 'running'],
          ['starting', 'error'],
        ];
        const isLegal = legalTransitions.some((t) => t[0] === event.from && t[1] === event.to);
        assert(isLegal, `Illegal transition: ${event.from} → ${event.to}`);
      }

      // Verify port and PID uniqueness
      const activeSlots = slotManager.getActiveSlots();
      const ports = activeSlots.map((s) => s.port);
      const pids = activeSlots.map((s) => s.process.pid);
      assert.strictEqual(new Set(ports).size, ports.length, 'All active slots should have unique ports');
      assert.strictEqual(new Set(pids).size, pids.length, 'All active slots should have unique PIDs');

      // Clear events for stop phase
      events.length = 0;

      // Stop the slot
      await slotManager.stopSlot(0);

      const stoppedSlot = slotManager.getSlot(0);
      assert.strictEqual(stoppedSlot.status, 'idle', 'Slot should be idle after stopSlot');
      assert.strictEqual(stoppedSlot.process, null, 'Slot process should be cleared');
      assert.strictEqual(stoppedSlot.modelPath, null, 'Slot modelPath should be cleared');

      // Verify stop events
      const stopEvents = events.filter((e) => e.slotId === 0);
      assert(stopEvents.length >= 2, 'Should have at least running→stopping and stopping→idle events');
      assert.strictEqual(stopEvents[0].from, 'running', 'First stop transition should be from running');
      assert.strictEqual(stopEvents[0].to, 'stopping', 'First stop transition should be to stopping');
      assert.strictEqual(stopEvents[stopEvents.length - 1].to, 'idle', 'Final stop transition should be to idle');

      // Verify legal transitions for stop
      for (const event of stopEvents) {
        const legalTransitions = [
          ['running', 'stopping'],
          ['stopping', 'idle'],
        ];
        const isLegal = legalTransitions.some((t) => t[0] === event.from && t[1] === event.to);
        assert(isLegal, `Illegal transition during stop: ${event.from} → ${event.to}`);
      }
    } finally {
      slotManager.removeListener('slot-status-changed', eventListener);
    }
  });

  it('should populate supportsTools via /props detection', async function () {
    const slot0 = slotManager.getSlot(0);

    // Start the slot
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    // Wait a bit for props detection to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check that supportsTools was populated
    const updatedSlot = slotManager.getSlot(0);
    assert.strictEqual(
      typeof updatedSlot.supportsTools,
      'boolean',
      'supportsTools should be a boolean after props detection'
    );
    assert.strictEqual(
      typeof updatedSlot.chatTemplate,
      'string',
      'chatTemplate should be a string after props detection'
    );

    // Clean up
    await slotManager.stopSlot(0);
  });

  it('should emit slot-status-changed events with ISO-8601 timestamps', async function () {
    const events = [];
    const eventListener = (event) => {
      events.push(event);
    };
    slotManager.on('slot-status-changed', eventListener);

    try {
      const slotConfig = {
        modelPath: fixtureModelPath,
        port: 13434,
        purpose: 'primary',
        advancedArgs: DEFAULT_ADVANCED_ARGS,
      };

      await slotManager.startSlot(0, slotConfig);
      await slotManager.stopSlot(0);

      // Verify all events have ISO-8601 timestamps
      const slot0Events = events.filter((e) => e.slotId === 0);
      for (const event of slot0Events) {
        assert.strictEqual(typeof event.at, 'string', 'Event should have "at" field');
        const timestamp = new Date(event.at);
        assert(!isNaN(timestamp.getTime()), `Event timestamp should be valid ISO-8601: ${event.at}`);
      }
    } finally {
      slotManager.removeListener('slot-status-changed', eventListener);
    }
  });

  it('should maintain port and PID uniqueness across multiple slots', async function () {
    // Start two slots
    const slot0Config = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const slot1Config = {
      modelPath: fixtureModelPath,
      port: 13435,
      purpose: 'secondary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    try {
      const slot0 = await slotManager.startSlot(0, slot0Config);
      const slot1 = await slotManager.startSlot(1, slot1Config);

      assert.strictEqual(slot0.status, 'running', 'Slot 0 should be running');
      assert.strictEqual(slot1.status, 'running', 'Slot 1 should be running');

      // Verify uniqueness
      assert.notStrictEqual(slot0.port, slot1.port, 'Slots should have different ports');
      assert.notStrictEqual(slot0.process.pid, slot1.process.pid, 'Slots should have different PIDs');

      // Verify getActiveSlots returns both
      const activeSlots = slotManager.getActiveSlots();
      assert.strictEqual(activeSlots.length, 2, 'Should have 2 active slots');

      const ports = activeSlots.map((s) => s.port);
      const pids = activeSlots.map((s) => s.process.pid);
      assert.strictEqual(new Set(ports).size, 2, 'All ports should be unique');
      assert.strictEqual(new Set(pids).size, 2, 'All PIDs should be unique');
    } finally {
      await slotManager.stopAll();
    }
  });
});
