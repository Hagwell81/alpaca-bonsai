/**
 * Property 15: validateAdvancedArgs schema closure
 *
 * For any generated AdvancedArgs shape (valid or invalid), the validateAdvancedArgs
 * function correctly validates all schema constraints and agrees with an independently-written
 * oracle predicate.
 *
 * Validates: Requirements 9.1, 9.6, 10.1, 10.7, 10.8, 11.1, 12.1, 12.3
 */

const assert = require('assert');
const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const { validateAdvancedArgs, DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

/**
 * Oracle predicate: independently validates AdvancedArgs against all schema constraints.
 * Returns true if valid, false otherwise.
 *
 * This oracle is written separately from validateAdvancedArgs to serve as a reference
 * implementation for property-based testing.
 */
function oracleValidateAdvancedArgs(a) {
  // Must be an object
  if (!a || typeof a !== 'object') {
    return false;
  }

  // Performance / memory flags (Req 9)
  if (typeof a.flashAttn !== 'boolean') return false;
  if (typeof a.mmap !== 'boolean') return false;
  if (typeof a.mlock !== 'boolean') return false;

  // Context and batch sizes (Req 9.1)
  if (!Number.isInteger(a.ctxSize) || a.ctxSize < 512) return false;
  if (!Number.isInteger(a.batchSize) || a.batchSize < 32) return false;
  if (!Number.isInteger(a.ubatchSize) || a.ubatchSize < 32) return false;

  // ubatchSize <= batchSize (Req 9.6)
  if (a.ubatchSize > a.batchSize) return false;

  // Parallel (Req 9.1)
  if (!Number.isInteger(a.parallel) || a.parallel < 1) return false;

  // Multi-GPU / distributed (Req 10)
  if (!Array.isArray(a.tensorSplit)) return false;

  // tensorSplit entries non-negative finite (Req 10.8)
  for (let i = 0; i < a.tensorSplit.length; i++) {
    const val = a.tensorSplit[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return false;
    }
  }

  // mainGpu (Req 10.1)
  if (!Number.isInteger(a.mainGpu) || a.mainGpu < 0) return false;

  // splitMode (Req 10.1)
  if (!['none', 'layer', 'row'].includes(a.splitMode)) return false;

  // rpc entries (Req 10.7)
  if (!Array.isArray(a.rpc)) return false;
  const rpcRegex = /^[^\s:]+:\d+$/;
  for (let i = 0; i < a.rpc.length; i++) {
    const entry = a.rpc[i];
    if (typeof entry !== 'string' || !rpcRegex.test(entry)) {
      return false;
    }
  }

  // contBatching (Req 10.1)
  if (typeof a.contBatching !== 'boolean') return false;

  // nGpuLayers (Req 1.5)
  if (!Number.isInteger(a.nGpuLayers) || a.nGpuLayers < -1 || a.nGpuLayers > 999) return false;

  // typeK / typeV (Req 2.3)
  const validKvTypes = ['f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'turbo4_0', 'turbo3_0', 'turbo2_0'];
  if (!validKvTypes.includes(a.typeK)) return false;
  if (!validKvTypes.includes(a.typeV)) return false;

  // nCpuMoe (Req 3.4)
  if (!Number.isInteger(a.nCpuMoe) || a.nCpuMoe < 0 || a.nCpuMoe > 999) return false;

  // threads (Req 4.4)
  if (!Number.isInteger(a.threads) || a.threads < 1 || a.threads > 256) return false;

  // Sampling params (Req 11.1)
  if (!a.sampling || typeof a.sampling !== 'object') return false;

  const samplingRanges = {
    temp: [0.0, 2.0],
    topK: [0, 1000],
    topP: [0.0, 1.0],
    repeatPenalty: [0.0, 2.0],
    presencePenalty: [-2.0, 2.0],
    frequencyPenalty: [-2.0, 2.0],
  };

  for (const [field, [min, max]] of Object.entries(samplingRanges)) {
    const val = a.sampling[field];
    if (typeof val !== 'number' || val < min || val > max) {
      return false;
    }
  }

  // seed (Req 11.1)
  if (!Number.isInteger(a.sampling.seed)) return false;

  // Speculative decoding (Req 12.1 + Phase 3)
  if (!a.speculative || typeof a.speculative !== 'object') return false;

  if (typeof a.speculative.enabled !== 'boolean') return false;

  const validModes = ['off', 'draft-model', 'mtp', 'eagle3', 'ngram', 'ngram-simple'];
  if (!validModes.includes(a.speculative.mode)) return false;

  // draftModel is required only for draft-model mode when enabled
  if (a.speculative.enabled && a.speculative.mode === 'draft-model') {
    if (typeof a.speculative.draftModel !== 'string' || !a.speculative.draftModel) {
      return false;
    }
    if (!fs.existsSync(a.speculative.draftModel)) {
      return false;
    }
  }

  // draftCtxSize (Req 12.1)
  if (!Number.isInteger(a.speculative.draftCtxSize) || a.speculative.draftCtxSize < 512) {
    return false;
  }

  // nMax / nMin / pMin (Phase 3)
  if (!Number.isInteger(a.speculative.nMax) || a.speculative.nMax < 1 || a.speculative.nMax > 32) {
    return false;
  }
  if (!Number.isInteger(a.speculative.nMin) || a.speculative.nMin < 1 || a.speculative.nMin > 32) {
    return false;
  }
  if (typeof a.speculative.pMin !== 'number' || a.speculative.pMin < 0.0 || a.speculative.pMin > 1.0) {
    return false;
  }

  return true;
}

/**
 * Fast-check arbitrary for generating valid AdvancedArgs
 */
const validAdvancedArgsArbitrary = () => {
  return fc.record({
    flashAttn: fc.boolean(),
    mmap: fc.boolean(),
    mlock: fc.boolean(),
    ctxSize: fc.integer({ min: 512, max: 32768 }),
    batchSize: fc.integer({ min: 32, max: 4096 }),
    ubatchSize: fc.integer({ min: 32, max: 4096 }),
    parallel: fc.integer({ min: 1, max: 16 }),
    tensorSplit: fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
    mainGpu: fc.integer({ min: 0, max: 8 }),
    splitMode: fc.constantFrom('none', 'layer', 'row'),
    rpc: fc.array(fc.constant('localhost:8000'), { maxLength: 4 }),
    contBatching: fc.boolean(),
    nGpuLayers: fc.integer({ min: -1, max: 999 }),
    typeK: fc.constantFrom('f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'turbo4_0', 'turbo3_0', 'turbo2_0'),
    typeV: fc.constantFrom('f32', 'f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'turbo4_0', 'turbo3_0', 'turbo2_0'),
    nCpuMoe: fc.integer({ min: 0, max: 999 }),
    threads: fc.integer({ min: 1, max: 256 }),
    sampling: fc.record({
      temp: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
      topK: fc.integer({ min: 0, max: 1000 }),
      topP: fc.float({ min: 0.0, max: 1.0, noNaN: true }),
      repeatPenalty: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
      presencePenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
      frequencyPenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
      seed: fc.integer(),
    }),
    speculative: fc.record({
      enabled: fc.constant(false),
      mode: fc.constantFrom('off', 'draft-model', 'mtp', 'eagle3', 'ngram', 'ngram-simple'),
      draftModel: fc.constant(null),
      draftCtxSize: fc.integer({ min: 512, max: 8192 }),
      nMax: fc.integer({ min: 1, max: 32 }),
      nMin: fc.integer({ min: 1, max: 32 }),
      pMin: fc.float({ min: 0.0, max: 1.0, noNaN: true }),
    }),
  }).map(record => ({
    ...record,
    ubatchSize: Math.min(record.ubatchSize, record.batchSize),
  }));
};

describe('P15: validateAdvancedArgs schema closure', () => {
  it('should validate valid AdvancedArgs correctly', () => {
    const property = fc.property(validAdvancedArgsArbitrary(), (args) => {
      const result = validateAdvancedArgs(args);
      const oracleResult = oracleValidateAdvancedArgs(args);

      // Both should agree on validity
      assert.strictEqual(result.ok, oracleResult, `Mismatch for args: ${JSON.stringify(args)}`);
    });

    fc.assert(property, { numRuns: 100 });
  });

  it('should validate DEFAULT_ADVANCED_ARGS', () => {
    const result = validateAdvancedArgs(DEFAULT_ADVANCED_ARGS);
    assert.strictEqual(result.ok, true, 'DEFAULT_ADVANCED_ARGS should be valid');
  });

  it('should reject ubatchSize > batchSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      batchSize: 100,
      ubatchSize: 200,
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'ubatchSize');
  });

  it('should reject invalid rpc format', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      rpc: ['invalid-format'],
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.startsWith('rpc'));
  });

  it('should reject negative tensorSplit values', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [0.5, -0.1],
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.includes('tensorSplit'));
  });

  it('should reject invalid splitMode', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      splitMode: 'invalid',
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'splitMode');
  });

  it('should reject sampling params outside ranges', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        temp: 3.0, // Outside [0.0, 2.0]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.temp');
  });

  it('should reject speculative.enabled without draftModel in draft-model mode', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        enabled: true,
        mode: 'draft-model',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 16,
        nMin: 4,
        pMin: 0.8,
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative.draftModel');
  });

  it('should reject speculative.draftModel that does not exist', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        enabled: true,
        mode: 'draft-model',
        draftModel: '/nonexistent/path/to/model.gguf',
        draftCtxSize: 4096,
        nMax: 16,
        nMin: 4,
        pMin: 0.8,
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative.draftModel');
  });

  it('should allow speculative.draftModel to be null when disabled', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        enabled: false,
        mode: 'off',
        draftModel: null,
        draftCtxSize: 4096,
        nMax: 16,
        nMin: 4,
        pMin: 0.8,
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, true);
  });

  it('should reject invalid ctxSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      ctxSize: 256, // Less than 512
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'ctxSize');
  });

  it('should reject invalid batchSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      batchSize: 16, // Less than 32
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'batchSize');
  });

  it('should reject invalid parallel', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      parallel: 0, // Less than 1
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'parallel');
  });

  it('should reject invalid mainGpu', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      mainGpu: -1, // Less than 0
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'mainGpu');
  });

  it('should reject non-object root', () => {
    const result = validateAdvancedArgs(null);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'root');
  });

  it('should reject non-integer seed', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        seed: 3.14, // Not an integer
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.seed');
  });

  it('should reject invalid flashAttn type', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      flashAttn: 'true', // String instead of boolean
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'flashAttn');
  });

  it('should reject invalid mmap type', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      mmap: 1, // Number instead of boolean
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'mmap');
  });

  it('should reject invalid mlock type', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      mlock: null, // Null instead of boolean
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'mlock');
  });

  it('should reject non-array tensorSplit', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: '0.5,0.5', // String instead of array
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'tensorSplit');
  });

  it('should reject non-array rpc', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      rpc: 'localhost:8000', // String instead of array
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'rpc');
  });

  it('should reject non-object sampling', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: null, // Null instead of object
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling');
  });

  it('should reject non-object speculative', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: null, // Null instead of object
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative');
  });

  it('should reject invalid speculative.enabled type', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        ...DEFAULT_ADVANCED_ARGS.speculative,
        enabled: 'true', // String instead of boolean
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative.enabled');
  });

  it('should reject invalid speculative.draftCtxSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        ...DEFAULT_ADVANCED_ARGS.speculative,
        draftCtxSize: 256, // Less than 512
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative.draftCtxSize');
  });

  it('should reject topK outside range', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        topK: 1001, // Outside [0, 1000]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.topK');
  });

  it('should reject topP outside range', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        topP: 1.5, // Outside [0.0, 1.0]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.topP');
  });

  it('should reject repeatPenalty outside range', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        repeatPenalty: 2.5, // Outside [0.0, 2.0]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.repeatPenalty');
  });

  it('should reject presencePenalty outside range', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        presencePenalty: 2.5, // Outside [-2.0, 2.0]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.presencePenalty');
  });

  it('should reject frequencyPenalty outside range', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        frequencyPenalty: -2.5, // Outside [-2.0, 2.0]
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'sampling.frequencyPenalty');
  });

  it('should reject non-integer ctxSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      ctxSize: 512.5, // Float instead of integer
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'ctxSize');
  });

  it('should reject non-integer batchSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      batchSize: 32.5, // Float instead of integer
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'batchSize');
  });

  it('should reject non-integer ubatchSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      ubatchSize: 32.5, // Float instead of integer
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'ubatchSize');
  });

  it('should reject non-integer parallel', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      parallel: 1.5, // Float instead of integer
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'parallel');
  });

  it('should reject non-integer mainGpu', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      mainGpu: 0.5, // Float instead of integer
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'mainGpu');
  });

  it('should reject non-integer draftCtxSize', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        ...DEFAULT_ADVANCED_ARGS.speculative,
        draftCtxSize: 512.5, // Float instead of integer
      },
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.field, 'speculative.draftCtxSize');
  });

  it('should reject rpc entry with spaces', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      rpc: ['local host:8000'], // Space in hostname
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.startsWith('rpc'));
  });

  it('should reject rpc entry without port', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      rpc: ['localhost'], // Missing port
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.startsWith('rpc'));
  });

  it('should reject rpc entry with non-numeric port', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      rpc: ['localhost:abc'], // Non-numeric port
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.startsWith('rpc'));
  });

  it('should reject tensorSplit with NaN', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [0.5, NaN],
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.includes('tensorSplit'));
  });

  it('should reject tensorSplit with Infinity', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [0.5, Infinity],
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.includes('tensorSplit'));
  });

  it('should reject tensorSplit with non-numeric value', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [0.5, 'invalid'],
    };

    const result = validateAdvancedArgs(args);
    assert.strictEqual(result.ok, false);
    assert(result.field.includes('tensorSplit'));
  });
});
