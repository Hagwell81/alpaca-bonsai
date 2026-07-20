/**
 * Property 30: getOrDefault returns documented defaults
 *
 * When a model config is not found in the store, getOrDefault returns
 * DEFAULT_ADVANCED_ARGS exactly.
 *
 * Validates: Requirements 20.3
 */

const assert = require('assert');
const fc = require('fast-check');
const { ModelConfigStore } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

describe('P30: getOrDefault returns documented defaults', () => {
  it('should return DEFAULT_ADVANCED_ARGS when config not found', () => {
    const property = fc.property(
      fc.string({ minLength: 1, maxLength: 100 }),
      (modelFilename) => {
        // Create a mock electron-store
        const mockStore = {
          has: () => true,
          get: () => ({}),
          set: () => {},
        };

        const store = new ModelConfigStore(mockStore);

        // Get a config that doesn't exist
        const result = store.getOrDefault(modelFilename);

        // Should return DEFAULT_ADVANCED_ARGS
        assert.deepStrictEqual(result, DEFAULT_ADVANCED_ARGS);
      }
    );

    fc.assert(property, { numRuns: 50 });
  });

  it('should return DEFAULT_ADVANCED_ARGS when config is corrupt', () => {
    // Create a mock electron-store with corrupt data
    const mockStore = {
      has: () => true,
      get: () => ({
        'model.gguf': 'not valid json',
      }),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);

    // Get a config that is corrupt
    const result = store.getOrDefault('model.gguf');

    // Should return DEFAULT_ADVANCED_ARGS
    assert.deepStrictEqual(result, DEFAULT_ADVANCED_ARGS);
  });

  it('should return DEFAULT_ADVANCED_ARGS for empty store', () => {
    const mockStore = {
      has: () => false,
      get: () => ({}),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);

    // Get a config from empty store
    const result = store.getOrDefault('any-model.gguf');

    // Should return DEFAULT_ADVANCED_ARGS
    assert.deepStrictEqual(result, DEFAULT_ADVANCED_ARGS);
  });

  it('should return a copy of DEFAULT_ADVANCED_ARGS, not the same reference', () => {
    const mockStore = {
      has: () => true,
      get: () => ({}),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);

    // Get defaults twice
    const result1 = store.getOrDefault('model1.gguf');
    const result2 = store.getOrDefault('model2.gguf');

    // Should be equal but not the same reference
    assert.deepStrictEqual(result1, result2);
    assert.notStrictEqual(result1, result2);
    assert.notStrictEqual(result1, DEFAULT_ADVANCED_ARGS);
  });

  it('should return DEFAULT_ADVANCED_ARGS with all documented fields', () => {
    const mockStore = {
      has: () => true,
      get: () => ({}),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);
    const result = store.getOrDefault('model.gguf');

    // Verify all documented fields are present
    assert(result.hasOwnProperty('flashAttn'));
    assert(result.hasOwnProperty('mmap'));
    assert(result.hasOwnProperty('mlock'));
    assert(result.hasOwnProperty('ctxSize'));
    assert(result.hasOwnProperty('batchSize'));
    assert(result.hasOwnProperty('ubatchSize'));
    assert(result.hasOwnProperty('parallel'));
    assert(result.hasOwnProperty('tensorSplit'));
    assert(result.hasOwnProperty('mainGpu'));
    assert(result.hasOwnProperty('splitMode'));
    assert(result.hasOwnProperty('rpc'));
    assert(result.hasOwnProperty('contBatching'));
    assert(result.hasOwnProperty('sampling'));
    assert(result.hasOwnProperty('speculative'));

    // Verify sampling fields
    assert(result.sampling.hasOwnProperty('temp'));
    assert(result.sampling.hasOwnProperty('topK'));
    assert(result.sampling.hasOwnProperty('topP'));
    assert(result.sampling.hasOwnProperty('repeatPenalty'));
    assert(result.sampling.hasOwnProperty('presencePenalty'));
    assert(result.sampling.hasOwnProperty('frequencyPenalty'));
    assert(result.sampling.hasOwnProperty('seed'));

    // Verify speculative fields
    assert(result.speculative.hasOwnProperty('enabled'));
    assert(result.speculative.hasOwnProperty('draftModel'));
    assert(result.speculative.hasOwnProperty('draftCtxSize'));
  });

  it('should return DEFAULT_ADVANCED_ARGS with correct default values', () => {
    const mockStore = {
      has: () => true,
      get: () => ({}),
      set: () => {},
    };

    const store = new ModelConfigStore(mockStore);
    const result = store.getOrDefault('model.gguf');

    // Verify specific default values
    assert.strictEqual(result.flashAttn, false);
    assert.strictEqual(result.mmap, true);
    assert.strictEqual(result.mlock, false);
    assert.strictEqual(result.ctxSize, 4096);
    assert.strictEqual(result.batchSize, 2048);
    assert.strictEqual(result.ubatchSize, 512);
    assert.strictEqual(result.parallel, 1);
    assert.deepStrictEqual(result.tensorSplit, []);
    assert.strictEqual(result.mainGpu, 0);
    assert.strictEqual(result.splitMode, 'layer');
    assert.deepStrictEqual(result.rpc, []);
    assert.strictEqual(result.contBatching, true);

    // Verify sampling defaults
    assert.strictEqual(result.sampling.temp, 0.8);
    assert.strictEqual(result.sampling.topK, 40);
    assert.strictEqual(result.sampling.topP, 0.95);
    assert.strictEqual(result.sampling.repeatPenalty, 1.1);
    assert.strictEqual(result.sampling.presencePenalty, 0.0);
    assert.strictEqual(result.sampling.frequencyPenalty, 0.0);
    assert.strictEqual(result.sampling.seed, -1);

    // Verify speculative defaults
    assert.strictEqual(result.speculative.enabled, false);
    assert.strictEqual(result.speculative.draftModel, null);
    assert.strictEqual(result.speculative.draftCtxSize, 4096);
  });
});
