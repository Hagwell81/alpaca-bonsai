/**
 * Unit tests for `ModelConfigStore` forward-compatible read of phase-1-shaped
 * Advanced_Args JSON (Reqs 11.2, 11.4 — examples companion to property P66).
 *
 * Covers:
 *  - Phase-1-shaped JSON (missing the five memory-tuning keys) loads with
 *    `MEMORY_ADVANCED_DEFAULTS` merged in, and NO `store.set` call fires as a
 *    side effect of `get` / `getOrDefault` / `listAll` (Req 11.2 tail — the
 *    on-disk rewrite is deferred until the user explicitly saves).
 *  - Wrong-type values for each of the five new keys (`nGpuLayers`, `typeK`,
 *    `typeV`, `nCpuMoe`, `threads`) substitute the documented default and emit
 *    exactly one `logger.warn` line per offending field (Req 11.4).
 *
 * The tests use an in-memory stub for `electron-store` so we can count
 * `store.set` invocations precisely; the real `electron-store` atomic-write
 * behaviour is already covered by `tests/unit/model-config-store.test.js`.
 */

const { expect } = require('chai');
const {
  ModelConfigStore,
  normalizeExtendedAdvancedArgs,
} = require('../../model-config-store');
const {
  DEFAULT_ADVANCED_ARGS,
  MEMORY_ADVANCED_DEFAULTS,
} = require('../../advanced-args');

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/**
 * A fully-populated phase-1 Advanced_Args object — i.e., exactly the shape
 * written by an installation that predates the memory-tuning phase. The five
 * memory keys (`nGpuLayers`, `typeK`, `typeV`, `nCpuMoe`, `threads`) are
 * INTENTIONALLY absent so the normaliser has to merge in their defaults.
 */
function makePhase1Args(overrides = {}) {
  return {
    flashAttn: false,
    mmap: true,
    mlock: false,
    ctxSize: 4096,
    batchSize: 2048,
    ubatchSize: 512,
    parallel: 1,
    tensorSplit: [],
    mainGpu: 0,
    splitMode: 'layer',
    rpc: [],
    contBatching: true,
    sampling: {
      temp: 0.8,
      topK: 40,
      topP: 0.95,
      repeatPenalty: 1.1,
      presencePenalty: 0.0,
      frequencyPenalty: 0.0,
      seed: -1,
    },
    speculative: {
      enabled: false,
      draftModel: null,
      draftCtxSize: 4096,
    },
    ...overrides,
  };
}

/**
 * Minimal in-memory stub for `electron-store`. Implements just the surface
 * `ModelConfigStore` touches (`get`, `set`, `has`) and tracks every `set`
 * invocation so tests can assert that the read path does NOT write.
 */
function makeFakeStore(initialConfigs = {}) {
  const state = {
    modelConfigs: { ...initialConfigs },
  };
  const setCalls = [];
  return {
    get: (key, fallback) =>
      Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback,
    set: (key, value) => {
      setCalls.push({ key, value });
      state[key] = value;
    },
    has: (key) => Object.prototype.hasOwnProperty.call(state, key),
    // test-only helpers
    __setCalls: setCalls,
    __state: state,
  };
}

/**
 * Capturing logger stub; every `warn` call is appended to `warnings`.
 */
function makeFakeLogger() {
  const warnings = [];
  return {
    warn: (msg) => warnings.push(msg),
    log: () => {},
    error: () => {},
    __warnings: warnings,
  };
}

/**
 * Serialises a config object into a JSON string and stores it under
 * `modelConfigs[filename]`, matching the on-disk layout written by
 * `ModelConfigStore.set`.
 */
function seed(fakeStore, filename, configObj) {
  const configs = fakeStore.get('modelConfigs', {});
  configs[filename] = JSON.stringify(configObj);
  // Write directly through the state object so this seeding does NOT count
  // against the `store.set` assertions the tests care about.
  fakeStore.__state.modelConfigs = configs;
}

// -----------------------------------------------------------------------------
// normalizeExtendedAdvancedArgs — direct unit coverage
// -----------------------------------------------------------------------------

describe('normalizeExtendedAdvancedArgs (Reqs 11.2, 11.4)', () => {
  it('merges all five memory-tuning defaults into phase-1-shaped input without warning', () => {
    const logger = makeFakeLogger();
    const raw = makePhase1Args();

    const result = normalizeExtendedAdvancedArgs(raw, 'model.gguf', logger);

    expect(result.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
    expect(result.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
    expect(result.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
    expect(result.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
    expect(result.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);

    // No warnings for a pure phase-1 shape (Req 11.2).
    expect(logger.__warnings).to.deep.equal([]);
  });

  it('does not mutate the input object', () => {
    const raw = makePhase1Args();
    const snapshot = JSON.stringify(raw);

    normalizeExtendedAdvancedArgs(raw, 'model.gguf', makeFakeLogger());

    expect(JSON.stringify(raw)).to.equal(snapshot);
  });

  it('preserves every phase-1 field unchanged', () => {
    const raw = makePhase1Args({
      ctxSize: 8192,
      batchSize: 1024,
      ubatchSize: 256,
      parallel: 2,
      flashAttn: true,
      mlock: true,
      tensorSplit: [0.5, 0.5],
      mainGpu: 1,
      splitMode: 'row',
      rpc: ['localhost:5555'],
      contBatching: false,
    });

    const result = normalizeExtendedAdvancedArgs(
      raw,
      'model.gguf',
      makeFakeLogger()
    );

    for (const key of Object.keys(raw)) {
      expect(result[key]).to.deep.equal(raw[key], `field '${key}' preserved`);
    }
  });

  it('keeps legal already-extended values untouched (no warnings, no substitutions)', () => {
    const logger = makeFakeLogger();
    const raw = makePhase1Args({
      nGpuLayers: 32,
      typeK: 'q8_0',
      typeV: 'q5_1',
      nCpuMoe: 5,
      threads: 16,
    });

    const result = normalizeExtendedAdvancedArgs(raw, 'model.gguf', logger);

    expect(result.nGpuLayers).to.equal(32);
    expect(result.typeK).to.equal('q8_0');
    expect(result.typeV).to.equal('q5_1');
    expect(result.nCpuMoe).to.equal(5);
    expect(result.threads).to.equal(16);
    expect(logger.__warnings).to.deep.equal([]);
  });

  it('returns non-object inputs unchanged so the caller can handle corrupt configs', () => {
    const logger = makeFakeLogger();
    expect(normalizeExtendedAdvancedArgs(null, 'x.gguf', logger)).to.equal(null);
    expect(normalizeExtendedAdvancedArgs(undefined, 'x.gguf', logger)).to.equal(
      undefined
    );
    expect(normalizeExtendedAdvancedArgs('string', 'x.gguf', logger)).to.equal(
      'string'
    );
    expect(normalizeExtendedAdvancedArgs(42, 'x.gguf', logger)).to.equal(42);
    // Arrays are not treated as config objects either.
    const arr = [1, 2, 3];
    expect(normalizeExtendedAdvancedArgs(arr, 'x.gguf', logger)).to.equal(arr);
    expect(logger.__warnings).to.deep.equal([]);
  });

  describe('wrong-type substitution per field (Req 11.4)', () => {
    // Each entry names the field, a concretely illegal value to plant, and the
    // default we expect the normaliser to substitute. The pattern of the
    // warning line is checked once globally below.
    const CASES = [
      { field: 'nGpuLayers', badValue: 'many' },
      { field: 'nGpuLayers', badValue: 1.5 },
      { field: 'nGpuLayers', badValue: -2 },
      { field: 'nGpuLayers', badValue: 1000 },
      { field: 'typeK', badValue: 'bogus' },
      { field: 'typeK', badValue: 16 },
      { field: 'typeK', badValue: null },
      { field: 'typeV', badValue: 'int8' },
      { field: 'typeV', badValue: false },
      { field: 'nCpuMoe', badValue: -1 },
      { field: 'nCpuMoe', badValue: 3.14 },
      { field: 'nCpuMoe', badValue: '7' },
      { field: 'threads', badValue: 0 },
      { field: 'threads', badValue: 257 },
      { field: 'threads', badValue: 4.5 },
      { field: 'threads', badValue: 'auto' },
    ];

    for (const { field, badValue } of CASES) {
      it(`substitutes default and emits one warn for ${field}=${JSON.stringify(
        badValue
      )}`, () => {
        const logger = makeFakeLogger();
        const raw = makePhase1Args({ [field]: badValue });

        const result = normalizeExtendedAdvancedArgs(
          raw,
          'model.gguf',
          logger
        );

        expect(result[field]).to.equal(MEMORY_ADVANCED_DEFAULTS[field]);
        expect(logger.__warnings).to.have.lengthOf(1);
        expect(logger.__warnings[0]).to.include('[ModelConfigStore]');
        expect(logger.__warnings[0]).to.include('model.gguf');
        expect(logger.__warnings[0]).to.include(field);
        expect(logger.__warnings[0]).to.include('invalid type');
        expect(logger.__warnings[0]).to.include('substituting default');
      });
    }

    it('emits exactly one warn per offending field when multiple are wrong', () => {
      const logger = makeFakeLogger();
      const raw = makePhase1Args({
        nGpuLayers: 'many',
        typeK: 'bogus',
        typeV: 17,
        nCpuMoe: -1,
        threads: 'auto',
      });

      const result = normalizeExtendedAdvancedArgs(
        raw,
        'model.gguf',
        logger
      );

      expect(result.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
      expect(result.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
      expect(result.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
      expect(result.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
      expect(result.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);

      // One warning per offending field — no duplicates, no misses.
      expect(logger.__warnings).to.have.lengthOf(5);
      for (const field of ['nGpuLayers', 'typeK', 'typeV', 'nCpuMoe', 'threads']) {
        const match = logger.__warnings.filter((w) => w.includes(` ${field} `));
        expect(match, `exactly one warn for ${field}`).to.have.lengthOf(1);
      }
    });
  });
});

// -----------------------------------------------------------------------------
// ModelConfigStore — read-path side-effect and forward-compat assertions
// -----------------------------------------------------------------------------

describe('ModelConfigStore forward-compat read (Reqs 11.2, 11.4)', () => {
  describe('phase-1-shaped JSON loads with defaults merged in (Req 11.2)', () => {
    it('get() merges the five memory-tuning defaults and does not call store.set', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });

      // Seed a phase-1 payload AFTER construction and reset the set-call log
      // so the constructor's one-time init of `modelConfigs` is not counted
      // against the read path.
      seed(fakeStore, 'phase1-model.gguf', makePhase1Args());
      fakeStore.__setCalls.length = 0;

      const result = configStore.get('phase1-model.gguf');

      expect(result).to.not.be.null;
      expect(result.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
      expect(result.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
      expect(result.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
      expect(result.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
      expect(result.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);

      // The read path must NOT rewrite the on-disk payload (Req 11.2 tail).
      expect(fakeStore.__setCalls).to.deep.equal([]);
      // A clean phase-1 payload produces no warnings.
      expect(logger.__warnings).to.deep.equal([]);
    });

    it('getOrDefault() merges the memory-tuning defaults without a store.set', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });

      seed(fakeStore, 'phase1-model.gguf', makePhase1Args({ ctxSize: 8192 }));
      fakeStore.__setCalls.length = 0;

      const result = configStore.getOrDefault('phase1-model.gguf');

      expect(result.ctxSize).to.equal(8192);
      expect(result.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
      expect(result.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
      expect(result.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
      expect(result.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
      expect(result.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);

      expect(fakeStore.__setCalls).to.deep.equal([]);
    });

    it('getOrDefault() on a missing key returns DEFAULT_ADVANCED_ARGS without writing', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });
      fakeStore.__setCalls.length = 0;

      const result = configStore.getOrDefault('unknown.gguf');

      expect(result).to.deep.equal(DEFAULT_ADVANCED_ARGS);
      expect(fakeStore.__setCalls).to.deep.equal([]);
    });

    it('listAll() merges defaults into every phase-1-shaped entry and does not call store.set', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });

      seed(fakeStore, 'alpha.gguf', makePhase1Args({ ctxSize: 2048 }));
      seed(fakeStore, 'beta.gguf', makePhase1Args({ ctxSize: 4096 }));
      seed(fakeStore, 'gamma.gguf', makePhase1Args({ ctxSize: 8192 }));
      fakeStore.__setCalls.length = 0;

      const all = configStore.listAll();

      expect(Object.keys(all)).to.have.members([
        'alpha.gguf',
        'beta.gguf',
        'gamma.gguf',
      ]);
      for (const key of Object.keys(all)) {
        expect(all[key].nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
        expect(all[key].typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
        expect(all[key].typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
        expect(all[key].nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
        expect(all[key].threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);
      }

      expect(fakeStore.__setCalls).to.deep.equal([]);
      expect(logger.__warnings).to.deep.equal([]);
    });

    it('does not call store.set even across repeated reads of the same phase-1 entry', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });
      seed(fakeStore, 'phase1-model.gguf', makePhase1Args());
      fakeStore.__setCalls.length = 0;

      for (let i = 0; i < 5; i++) {
        configStore.get('phase1-model.gguf');
        configStore.getOrDefault('phase1-model.gguf');
        configStore.listAll();
      }

      expect(fakeStore.__setCalls).to.deep.equal([]);
    });
  });

  describe('wrong-type values substitute defaults with one warn per field (Req 11.4)', () => {
    const FIELDS = [
      { field: 'nGpuLayers', badValue: 'many' },
      { field: 'typeK', badValue: 'bogus' },
      { field: 'typeV', badValue: 17 },
      { field: 'nCpuMoe', badValue: -1 },
      { field: 'threads', badValue: 'auto' },
    ];

    for (const { field, badValue } of FIELDS) {
      it(`substitutes default for ${field} and emits exactly one warn`, () => {
        const fakeStore = makeFakeStore({});
        const logger = makeFakeLogger();
        const configStore = new ModelConfigStore(fakeStore, { logger });

        seed(
          fakeStore,
          'bad.gguf',
          makePhase1Args({ [field]: badValue })
        );
        fakeStore.__setCalls.length = 0;

        const result = configStore.get('bad.gguf');

        expect(result).to.not.be.null;
        expect(result[field]).to.equal(MEMORY_ADVANCED_DEFAULTS[field]);
        expect(logger.__warnings).to.have.lengthOf(1);
        expect(logger.__warnings[0]).to.include('[ModelConfigStore]');
        expect(logger.__warnings[0]).to.include('bad.gguf');
        expect(logger.__warnings[0]).to.include(field);
        expect(logger.__warnings[0]).to.include('invalid type');
        // No on-disk rewrite fires for a wrong-type repair either.
        expect(fakeStore.__setCalls).to.deep.equal([]);
      });
    }

    it('substitutes defaults for all five wrong-type keys and emits one warn per field', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });

      seed(
        fakeStore,
        'bad.gguf',
        makePhase1Args({
          nGpuLayers: 'many',
          typeK: 'bogus',
          typeV: 17,
          nCpuMoe: -1,
          threads: 'auto',
        })
      );
      fakeStore.__setCalls.length = 0;

      const result = configStore.get('bad.gguf');

      expect(result).to.not.be.null;
      expect(result.nGpuLayers).to.equal(MEMORY_ADVANCED_DEFAULTS.nGpuLayers);
      expect(result.typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
      expect(result.typeV).to.equal(MEMORY_ADVANCED_DEFAULTS.typeV);
      expect(result.nCpuMoe).to.equal(MEMORY_ADVANCED_DEFAULTS.nCpuMoe);
      expect(result.threads).to.equal(MEMORY_ADVANCED_DEFAULTS.threads);

      expect(logger.__warnings).to.have.lengthOf(5);
      for (const field of [
        'nGpuLayers',
        'typeK',
        'typeV',
        'nCpuMoe',
        'threads',
      ]) {
        const match = logger.__warnings.filter((w) => w.includes(` ${field} `));
        expect(match, `one warn for ${field}`).to.have.lengthOf(1);
      }

      // Even with substitutions the read path does not rewrite on disk.
      expect(fakeStore.__setCalls).to.deep.equal([]);
    });

    it('listAll() reports wrong-type fields for each offending entry without writing', () => {
      const fakeStore = makeFakeStore({});
      const logger = makeFakeLogger();
      const configStore = new ModelConfigStore(fakeStore, { logger });

      seed(fakeStore, 'clean.gguf', makePhase1Args());
      seed(fakeStore, 'bad-typeK.gguf', makePhase1Args({ typeK: 'bogus' }));
      seed(fakeStore, 'bad-threads.gguf', makePhase1Args({ threads: 'auto' }));
      fakeStore.__setCalls.length = 0;

      const all = configStore.listAll();

      expect(all['clean.gguf'].typeK).to.equal(MEMORY_ADVANCED_DEFAULTS.typeK);
      expect(all['bad-typeK.gguf'].typeK).to.equal(
        MEMORY_ADVANCED_DEFAULTS.typeK
      );
      expect(all['bad-threads.gguf'].threads).to.equal(
        MEMORY_ADVANCED_DEFAULTS.threads
      );

      // Exactly two warnings: one for typeK on bad-typeK.gguf and one for
      // threads on bad-threads.gguf. The clean entry emits none.
      expect(logger.__warnings).to.have.lengthOf(2);
      expect(
        logger.__warnings.some(
          (w) => w.includes('bad-typeK.gguf') && w.includes('typeK')
        )
      ).to.equal(true);
      expect(
        logger.__warnings.some(
          (w) => w.includes('bad-threads.gguf') && w.includes('threads')
        )
      ).to.equal(true);

      expect(fakeStore.__setCalls).to.deep.equal([]);
    });
  });
});
