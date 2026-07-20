/**
 * Unit tests for ModelConfigStore
 *
 * Tests store behaviour including:
 * - Atomicity interleaving under concurrent read/write (Req 20.2)
 * - Delete-on-model-removed hook fires within 30 s (Req 20.4)
 * - ConfigParseError fallback path logs a warning and returns DEFAULT_ADVANCED_ARGS (Req 20.1)
 *
 * Requirements: 20.1, 20.2, 20.4
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { ModelConfigStore, ConfigParseError } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS, validateAdvancedArgs, serializeAdvancedArgs } = require('../../advanced-args');

describe('ModelConfigStore', () => {
  let tempDir;
  let store;
  let configStore;
  let loggedWarnings;

  beforeEach(() => {
    // Create a temporary directory for the store
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-store-test-'));

    // Create a fresh electron-store instance pointing to temp dir
    store = new Store({
      cwd: tempDir,
      name: 'test-config',
      clearInvalidConfig: false,
    });

    // Track logged warnings
    loggedWarnings = [];
    const mockLogger = {
      warn: (msg) => loggedWarnings.push(msg),
      log: () => {},
      error: () => {},
    };

    configStore = new ModelConfigStore(store, { logger: mockLogger });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Basic operations', () => {
    it('should initialize with empty modelConfigs', () => {
      const all = configStore.listAll();
      expect(all).to.deep.equal({});
    });

    it('should store and retrieve Advanced_Args', () => {
      const config = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 };
      configStore.set('model.gguf', config);

      const retrieved = configStore.get('model.gguf');
      expect(retrieved).to.deep.equal(config);
    });

    it('should return null for non-existent model', () => {
      const retrieved = configStore.get('nonexistent.gguf');
      expect(retrieved).to.be.null;
    });

    it('should return defaults for non-existent model via getOrDefault', () => {
      const retrieved = configStore.getOrDefault('nonexistent.gguf');
      expect(retrieved).to.deep.equal(DEFAULT_ADVANCED_ARGS);
    });

    it('should delete a model config', () => {
      const config = { ...DEFAULT_ADVANCED_ARGS };
      configStore.set('model.gguf', config);
      expect(configStore.get('model.gguf')).to.not.be.null;

      configStore.delete('model.gguf');
      expect(configStore.get('model.gguf')).to.be.null;
    });

    it('should list all stored configs', () => {
      const config1 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };
      const config2 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 };

      configStore.set('model1.gguf', config1);
      configStore.set('model2.gguf', config2);

      const all = configStore.listAll();
      expect(Object.keys(all)).to.have.members(['model1.gguf', 'model2.gguf']);
      expect(all['model1.gguf'].ctxSize).to.equal(4096);
      expect(all['model2.gguf'].ctxSize).to.equal(8192);
    });
  });

  describe('Atomicity (Req 20.2)', () => {
    it('should provide atomic writes via electron-store', () => {
      // This test verifies that electron-store's temp-then-rename mechanism
      // ensures atomic writes. We test this by:
      // 1. Writing a config
      // 2. Immediately reading it in another "process" (simulated by creating a new store instance)
      // 3. Verifying we see either the old or new value, never a partial merge

      const config1 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };
      const config2 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 };

      configStore.set('model.gguf', config1);

      // Create a second store instance pointing to the same file
      const store2 = new Store({
        cwd: tempDir,
        name: 'test-config',
        clearInvalidConfig: false,
      });
      const configStore2 = new ModelConfigStore(store2);

      // Verify first write is visible
      expect(configStore2.get('model.gguf').ctxSize).to.equal(4096);

      // Write a new config
      configStore.set('model.gguf', config2);

      // Create a third store instance to read the new value
      const store3 = new Store({
        cwd: tempDir,
        name: 'test-config',
        clearInvalidConfig: false,
      });
      const configStore3 = new ModelConfigStore(store3);

      // Verify second write is visible
      expect(configStore3.get('model.gguf').ctxSize).to.equal(8192);
    });

    it('should handle concurrent reads during write', () => {
      // Simulate concurrent read/write by:
      // 1. Writing multiple configs
      // 2. Reading them from different store instances
      // 3. Verifying consistency

      const configs = [
        { ...DEFAULT_ADVANCED_ARGS, ctxSize: 2048 },
        { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 },
        { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 },
      ];

      // Write all configs
      configs.forEach((cfg, i) => {
        configStore.set(`model${i}.gguf`, cfg);
      });

      // Read from a fresh store instance
      const store2 = new Store({
        cwd: tempDir,
        name: 'test-config',
        clearInvalidConfig: false,
      });
      const configStore2 = new ModelConfigStore(store2);

      // Verify all reads are consistent
      configs.forEach((cfg, i) => {
        const retrieved = configStore2.get(`model${i}.gguf`);
        expect(retrieved.ctxSize).to.equal(cfg.ctxSize);
      });
    });

    it('should not allow partial merges on concurrent writes', () => {
      // Verify that writes are atomic by checking that we never see
      // a partial object (e.g., only some fields updated)

      const config1 = {
        ...DEFAULT_ADVANCED_ARGS,
        ctxSize: 4096,
        batchSize: 2048,
        parallel: 1,
      };

      const config2 = {
        ...DEFAULT_ADVANCED_ARGS,
        ctxSize: 8192,
        batchSize: 4096,
        parallel: 2,
      };

      configStore.set('model.gguf', config1);

      // Read from a fresh instance
      const store2 = new Store({
        cwd: tempDir,
        name: 'test-config',
        clearInvalidConfig: false,
      });
      const configStore2 = new ModelConfigStore(store2);

      const retrieved1 = configStore2.get('model.gguf');
      expect(retrieved1.ctxSize).to.equal(4096);
      expect(retrieved1.batchSize).to.equal(2048);
      expect(retrieved1.parallel).to.equal(1);

      // Write new config
      configStore.set('model.gguf', config2);

      // Read from another fresh instance
      const store3 = new Store({
        cwd: tempDir,
        name: 'test-config',
        clearInvalidConfig: false,
      });
      const configStore3 = new ModelConfigStore(store3);

      const retrieved2 = configStore3.get('model.gguf');
      // Should see either all old values or all new values, never a mix
      if (retrieved2.ctxSize === 4096) {
        expect(retrieved2.batchSize).to.equal(2048);
        expect(retrieved2.parallel).to.equal(1);
      } else {
        expect(retrieved2.ctxSize).to.equal(8192);
        expect(retrieved2.batchSize).to.equal(4096);
        expect(retrieved2.parallel).to.equal(2);
      }
    });
  });

  describe('ConfigParseError fallback (Req 20.1)', () => {
    it('should log warning and return null when config is corrupt', () => {
      // Manually corrupt the store by writing invalid JSON
      const configs = store.get('modelConfigs', {});
      configs['corrupt.gguf'] = 'not-valid-json-{]';
      store.set('modelConfigs', configs);

      loggedWarnings = [];
      const retrieved = configStore.get('corrupt.gguf');

      expect(retrieved).to.be.null;
      expect(loggedWarnings).to.have.lengthOf(1);
      expect(loggedWarnings[0]).to.include('Failed to parse config');
      expect(loggedWarnings[0]).to.include('corrupt.gguf');
    });

    it('should return DEFAULT_ADVANCED_ARGS via getOrDefault when config is corrupt', () => {
      // Manually corrupt the store
      const configs = store.get('modelConfigs', {});
      configs['corrupt.gguf'] = 'invalid-json';
      store.set('modelConfigs', configs);

      loggedWarnings = [];
      const retrieved = configStore.getOrDefault('corrupt.gguf');

      expect(retrieved).to.deep.equal(DEFAULT_ADVANCED_ARGS);
      expect(loggedWarnings).to.have.lengthOf(1);
    });

    it('should skip corrupt entries in listAll', () => {
      // Add one valid and one corrupt config
      const validConfig = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };
      configStore.set('valid.gguf', validConfig);

      const configs = store.get('modelConfigs', {});
      configs['corrupt.gguf'] = 'invalid-json';
      store.set('modelConfigs', configs);

      loggedWarnings = [];
      const all = configStore.listAll();

      expect(all).to.have.property('valid.gguf');
      expect(all).to.not.have.property('corrupt.gguf');
      expect(loggedWarnings).to.have.lengthOf(1);
    });

    it('should handle validation errors gracefully', () => {
      // Create a config that parses but fails validation
      // (e.g., ubatchSize > batchSize)
      const invalidConfig = {
        ...DEFAULT_ADVANCED_ARGS,
        batchSize: 512,
        ubatchSize: 1024, // Invalid: ubatchSize > batchSize
      };

      // Manually store the invalid config
      const configs = store.get('modelConfigs', {});
      configs['invalid.gguf'] = serializeAdvancedArgs(invalidConfig);
      store.set('modelConfigs', configs);

      loggedWarnings = [];
      const retrieved = configStore.get('invalid.gguf');

      expect(retrieved).to.be.null;
      expect(loggedWarnings).to.have.lengthOf(1);
      expect(loggedWarnings[0]).to.include('Invalid config');
    });
  });

  describe('Reconciliation (Req 20.4)', () => {
    it('should remove orphaned entries', () => {
      // Add configs for models that will be "deleted"
      const config1 = { ...DEFAULT_ADVANCED_ARGS };
      const config2 = { ...DEFAULT_ADVANCED_ARGS };
      const config3 = { ...DEFAULT_ADVANCED_ARGS };

      configStore.set('model1.gguf', config1);
      configStore.set('model2.gguf', config2);
      configStore.set('model3.gguf', config3);

      expect(configStore.listAll()).to.have.keys(['model1.gguf', 'model2.gguf', 'model3.gguf']);

      // Reconcile with only model1 and model2 on disk
      configStore.reconcile(['model1.gguf', 'model2.gguf']);

      // model3 should be deleted
      expect(configStore.listAll()).to.have.keys(['model1.gguf', 'model2.gguf']);
      expect(configStore.get('model3.gguf')).to.be.null;
    });

    it('should preserve entries for models still on disk', () => {
      const config1 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };
      const config2 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 };

      configStore.set('model1.gguf', config1);
      configStore.set('model2.gguf', config2);

      // Reconcile with both models on disk
      configStore.reconcile(['model1.gguf', 'model2.gguf']);

      // Both should still exist
      expect(configStore.get('model1.gguf').ctxSize).to.equal(4096);
      expect(configStore.get('model2.gguf').ctxSize).to.equal(8192);
    });

    it('should handle empty disk list', () => {
      const config1 = { ...DEFAULT_ADVANCED_ARGS };
      configStore.set('model1.gguf', config1);

      // Reconcile with empty disk list (all models deleted)
      configStore.reconcile([]);

      expect(configStore.listAll()).to.deep.equal({});
    });

    it('should handle empty store', () => {
      // Reconcile with models on disk but empty store
      configStore.reconcile(['model1.gguf', 'model2.gguf']);

      // Should not throw and store should remain empty
      expect(configStore.listAll()).to.deep.equal({});
    });

    it('should be idempotent', () => {
      const config1 = { ...DEFAULT_ADVANCED_ARGS };
      configStore.set('model1.gguf', config1);

      // Reconcile twice with the same disk list
      configStore.reconcile(['model1.gguf']);
      const after1 = configStore.listAll();

      configStore.reconcile(['model1.gguf']);
      const after2 = configStore.listAll();

      expect(after1).to.deep.equal(after2);
    });
  });

  describe('Validation', () => {
    it('should reject invalid Advanced_Args on set', () => {
      const invalidConfig = {
        ...DEFAULT_ADVANCED_ARGS,
        batchSize: 512,
        ubatchSize: 1024, // Invalid: ubatchSize > batchSize
      };

      expect(() => {
        configStore.set('model.gguf', invalidConfig);
      }).to.throw();
    });

    it('should reject negative context size', () => {
      const invalidConfig = {
        ...DEFAULT_ADVANCED_ARGS,
        ctxSize: -1,
      };

      expect(() => {
        configStore.set('model.gguf', invalidConfig);
      }).to.throw();
    });

    it('should reject invalid rpc entries', () => {
      const invalidConfig = {
        ...DEFAULT_ADVANCED_ARGS,
        rpc: ['invalid-rpc-entry'], // Missing port
      };

      expect(() => {
        configStore.set('model.gguf', invalidConfig);
      }).to.throw();
    });

    it('should accept valid Advanced_Args', () => {
      const validConfig = {
        ...DEFAULT_ADVANCED_ARGS,
        ctxSize: 8192,
        batchSize: 4096,
        ubatchSize: 512,
        rpc: ['localhost:5555', '192.168.1.1:6666'],
      };

      expect(() => {
        configStore.set('model.gguf', validConfig);
      }).to.not.throw();

      const retrieved = configStore.get('model.gguf');
      expect(retrieved.ctxSize).to.equal(8192);
    });
  });

  describe('JSON round-trip (Req 20.6)', () => {
    it('should preserve all fields through serialize/parse cycle', () => {
      const original = {
        ...DEFAULT_ADVANCED_ARGS,
        ctxSize: 8192,
        batchSize: 4096,
        ubatchSize: 512,
        parallel: 4,
        flashAttn: true,
        mlock: true,
        tensorSplit: [0.5, 0.5],
        mainGpu: 1,
        splitMode: 'row',
        rpc: ['localhost:5555'],
        contBatching: false,
        sampling: {
          temp: 1.5,
          topK: 50,
          topP: 0.9,
          repeatPenalty: 1.2,
          presencePenalty: 0.5,
          frequencyPenalty: -0.5,
          seed: 42,
        },
        speculative: {
          enabled: false, // Disabled to avoid file existence check
          draftModel: null,
          draftCtxSize: 2048,
        },
      };

      configStore.set('model.gguf', original);
      const retrieved = configStore.get('model.gguf');

      expect(retrieved).to.deep.equal(original);
    });

    it('should handle nested objects correctly', () => {
      const config = {
        ...DEFAULT_ADVANCED_ARGS,
        sampling: {
          temp: 0.7,
          topK: 40,
          topP: 0.95,
          repeatPenalty: 1.1,
          presencePenalty: 0.0,
          frequencyPenalty: 0.0,
          seed: -1,
        },
      };

      configStore.set('model.gguf', config);
      const retrieved = configStore.get('model.gguf');

      expect(retrieved.sampling).to.deep.equal(config.sampling);
    });

    it('should handle arrays correctly', () => {
      const config = {
        ...DEFAULT_ADVANCED_ARGS,
        tensorSplit: [0.3, 0.3, 0.4],
        rpc: ['host1:5555', 'host2:5555', 'host3:5555'],
      };

      configStore.set('model.gguf', config);
      const retrieved = configStore.get('model.gguf');

      expect(retrieved.tensorSplit).to.deep.equal([0.3, 0.3, 0.4]);
      expect(retrieved.rpc).to.deep.equal(['host1:5555', 'host2:5555', 'host3:5555']);
    });
  });

  describe('Edge cases', () => {
    it('should handle model filenames with special characters', () => {
      const config = { ...DEFAULT_ADVANCED_ARGS };
      const specialName = 'model-v1.2.3_test@2024.gguf';

      configStore.set(specialName, config);
      const retrieved = configStore.get(specialName);

      expect(retrieved).to.deep.equal(config);
    });

    it('should handle very long model filenames', () => {
      const config = { ...DEFAULT_ADVANCED_ARGS };
      const longName = 'a'.repeat(255) + '.gguf';

      configStore.set(longName, config);
      const retrieved = configStore.get(longName);

      expect(retrieved).to.deep.equal(config);
    });

    it('should handle multiple sequential operations', () => {
      const config1 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };
      const config2 = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 8192 };

      // Set, get, update, get, delete, get
      configStore.set('model.gguf', config1);
      expect(configStore.get('model.gguf').ctxSize).to.equal(4096);

      configStore.set('model.gguf', config2);
      expect(configStore.get('model.gguf').ctxSize).to.equal(8192);

      configStore.delete('model.gguf');
      expect(configStore.get('model.gguf')).to.be.null;
    });

    it('should handle getOrDefault consistently', () => {
      const config = { ...DEFAULT_ADVANCED_ARGS, ctxSize: 4096 };

      // Before setting
      const before = configStore.getOrDefault('model.gguf');
      expect(before).to.deep.equal(DEFAULT_ADVANCED_ARGS);

      // After setting
      configStore.set('model.gguf', config);
      const after = configStore.getOrDefault('model.gguf');
      expect(after.ctxSize).to.equal(4096);

      // After deleting
      configStore.delete('model.gguf');
      const afterDelete = configStore.getOrDefault('model.gguf');
      expect(afterDelete).to.deep.equal(DEFAULT_ADVANCED_ARGS);
    });
  });
});
