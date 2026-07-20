/**
 * Property 31: reconcile deletes exactly orphan entries
 *
 * The reconcile method removes stored configs for models that no longer
 * exist on disk, and preserves configs for models that do exist.
 *
 * Validates: Requirements 20.5
 */

const assert = require('assert');
const fc = require('fast-check');
const { ModelConfigStore } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS, serializeAdvancedArgs } = require('../../advanced-args');

describe('P31: reconcile deletes exactly orphan entries', () => {
  it('should delete configs for models not on disk', () => {
    const property = fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
      (storedModels, diskModels) => {
        // Create a mock electron-store with some configs
        const configs = {};
        for (const model of storedModels) {
          configs[model] = serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS);
        }

        let currentConfigs = { ...configs };
        const mockStore = {
          has: () => true,
          get: (key) => {
            if (key === 'modelConfigs') return currentConfigs;
            return {};
          },
          set: (key, value) => {
            if (key === 'modelConfigs') {
              currentConfigs = value;
            }
          },
        };

        const store = new ModelConfigStore(mockStore);

        // Reconcile with disk models
        store.reconcile(diskModels);

        // Get the reconciled configs
        const reconciled = store.listAll();

        // Verify: only models that are on disk should remain
        const diskSet = new Set(diskModels);
        for (const model of Object.keys(reconciled)) {
          assert(diskSet.has(model), `Model ${model} should be on disk`);
        }

        // Verify: all models on disk should be in reconciled (if they were stored)
        for (const model of diskModels) {
          if (storedModels.includes(model)) {
            assert(reconciled.hasOwnProperty(model), `Model ${model} should be preserved`);
          }
        }
      }
    );

    fc.assert(property, { numRuns: 50 });
  });

  it('should preserve configs for models on disk', () => {
    const mockStore = {
      has: () => true,
      get: () => ({
        'model1.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
        'model2.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
        'model3.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      }),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);

    // Reconcile with all models on disk
    store.reconcile(['model1.gguf', 'model2.gguf', 'model3.gguf']);

    // All should be preserved
    const result = store.listAll();
    assert.strictEqual(Object.keys(result).length, 3);
    assert(result.hasOwnProperty('model1.gguf'));
    assert(result.hasOwnProperty('model2.gguf'));
    assert(result.hasOwnProperty('model3.gguf'));
  });

  it('should delete all configs when disk is empty', () => {
    let currentConfigs = {
      'model1.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model2.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
    };

    const mockStore = {
      has: () => true,
      get: (key) => {
        if (key === 'modelConfigs') return currentConfigs;
        return {};
      },
      set: (key, value) => {
        if (key === 'modelConfigs') {
          currentConfigs = value;
        }
      },
    };

    const store = new ModelConfigStore(mockStore);

    // Reconcile with empty disk
    store.reconcile([]);

    // All should be deleted
    const result = store.listAll();
    assert.strictEqual(Object.keys(result).length, 0);
  });

  it('should handle partial overlap correctly', () => {
    let currentConfigs = {
      'model1.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model2.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model3.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model4.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
    };

    const mockStore = {
      has: () => true,
      get: (key) => {
        if (key === 'modelConfigs') return currentConfigs;
        return {};
      },
      set: (key, value) => {
        if (key === 'modelConfigs') {
          currentConfigs = value;
        }
      },
    };

    const store = new ModelConfigStore(mockStore);

    // Reconcile with only some models on disk
    store.reconcile(['model1.gguf', 'model3.gguf']);

    // Only model1 and model3 should remain
    const result = store.listAll();
    assert.strictEqual(Object.keys(result).length, 2);
    assert(result.hasOwnProperty('model1.gguf'));
    assert(result.hasOwnProperty('model3.gguf'));
    assert(!result.hasOwnProperty('model2.gguf'));
    assert(!result.hasOwnProperty('model4.gguf'));
  });

  it('should handle empty stored configs', () => {
    const mockStore = {
      has: () => true,
      get: () => ({}),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);

    // Reconcile with some models on disk
    store.reconcile(['model1.gguf', 'model2.gguf']);

    // Should remain empty
    const result = store.listAll();
    assert.strictEqual(Object.keys(result).length, 0);
  });

  it('should delete exactly the orphan entries (set difference)', () => {
    const property = fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
      fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
      (storedModels, diskModels) => {
        // Remove duplicates
        const storedSet = new Set(storedModels);
        const diskSet = new Set(diskModels);

        // Create configs for stored models
        const configs = {};
        for (const model of storedSet) {
          configs[model] = serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS);
        }

        let currentConfigs = { ...configs };
        const mockStore = {
          has: () => true,
          get: (key) => {
            if (key === 'modelConfigs') return currentConfigs;
            return {};
          },
          set: (key, value) => {
            if (key === 'modelConfigs') {
              currentConfigs = value;
            }
          },
        };

        const store = new ModelConfigStore(mockStore);

        // Reconcile
        store.reconcile(Array.from(diskSet));

        // Get reconciled configs
        const reconciled = store.listAll();
        const reconciledSet = new Set(Object.keys(reconciled));

        // Verify: reconciled = stored ∩ disk
        const expectedSet = new Set([...storedSet].filter(m => diskSet.has(m)));

        assert.strictEqual(reconciledSet.size, expectedSet.size);
        for (const model of expectedSet) {
          assert(reconciledSet.has(model), `Model ${model} should be in reconciled set`);
        }
        for (const model of reconciledSet) {
          assert(expectedSet.has(model), `Model ${model} should not be in reconciled set`);
        }
      }
    );

    fc.assert(property, { numRuns: 50 });
  });

  it('should handle models with special characters in names', () => {
    let currentConfigs = {
      'model-v1.0.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model_v2.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
      'model.backup.gguf': serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS),
    };

    const mockStore = {
      has: () => true,
      get: (key) => {
        if (key === 'modelConfigs') return currentConfigs;
        return {};
      },
      set: (key, value) => {
        if (key === 'modelConfigs') {
          currentConfigs = value;
        }
      },
    };

    const store = new ModelConfigStore(mockStore);

    // Reconcile with subset
    store.reconcile(['model-v1.0.gguf', 'model.backup.gguf']);

    // Only those two should remain
    const result = store.listAll();
    assert.strictEqual(Object.keys(result).length, 2);
    assert(result.hasOwnProperty('model-v1.0.gguf'));
    assert(result.hasOwnProperty('model.backup.gguf'));
    assert(!result.hasOwnProperty('model_v2.gguf'));
  });
});
