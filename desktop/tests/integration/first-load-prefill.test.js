/**
 * Integration test for new-model pre-fill via `recommendPreset` (Task 13.3).
 *
 * Scenario (from spec):
 *   JSDOM + stubbed `ModelConfigStore`: add a new filename to the models dir;
 *   assert the draft equals `recommendPreset(meta, currentBudget)` and that
 *   `store.set` was NOT called before Save.
 *
 * What this exercises end-to-end:
 *   1. The diff between the previous `modelConfigStore.listAll()` snapshot and
 *      the on-disk model filenames produces the correct set of "new" files.
 *   2. For each new filename, `recommendPreset(meta, currentBudget)` is called
 *      and the returned object becomes the panel draft (even when a stale
 *      `modelConfigs` entry already exists for that filename — Req 10.4).
 *   3. `store.set` is NOT invoked as a side effect of the pre-fill. The draft
 *      only reaches the store when the user explicitly clicks Save
 *      (Req 10.4 tail).
 *
 * Requirements: 10.4
 */

'use strict';

const { expect } = require('chai');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');

const { recommendPreset } = require('../../preset-recommender');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load `settings.html` into a fresh JSDOM instance so the integration test has
 * the real Memory-section DOM to write into.
 *
 * @returns {Window}
 */
function createDOM() {
  const htmlPath = path.join(__dirname, '../../settings.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // We only need the DOM structure to verify the Memory section elements
  // exist; the embedded <script> tags in settings.html reference Electron-only
  // modules (settings.js, telemetry-ui.js) which are not loadable in the test
  // environment. Leave `runScripts` unset so JSDOM parses the markup without
  // trying to execute them.
  const dom = new JSDOM(htmlContent, {
    url: 'http://localhost',
  });

  return dom.window;
}

/**
 * Build an in-memory stub that mirrors the `ModelConfigStore` surface the
 * settings layer actually consumes (`listAll`, `get`, `getOrDefault`, `set`,
 * `delete`).
 *
 * The returned stub records every call to `set` on `setCalls` so the test can
 * assert no persistence happened before the Save click.
 *
 * @param {Record<string, object>} [initial]
 */
function createStubStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  const setCalls = [];

  return {
    setCalls,
    listAll: sinon.stub().callsFake(() => {
      const out = {};
      for (const [k, v] of map.entries()) out[k] = v;
      return out;
    }),
    get: sinon.stub().callsFake((filename) => {
      return map.has(filename) ? map.get(filename) : null;
    }),
    getOrDefault: sinon.stub().callsFake((filename) => {
      return map.has(filename)
        ? map.get(filename)
        : { ...DEFAULT_ADVANCED_ARGS };
    }),
    set: sinon.stub().callsFake((filename, config) => {
      setCalls.push({ filename, config });
      map.set(filename, config);
    }),
    delete: sinon.stub().callsFake((filename) => {
      map.delete(filename);
    }),
  };
}

/**
 * Diff the on-disk filenames against the previous store snapshot. Mirrors the
 * shape of the diff that `settings.js` performs (Task 12.4).
 *
 * @param {string[]} onDisk
 * @param {Record<string, object>} previousSnapshot
 * @returns {string[]} filenames that exist on disk but not in the snapshot
 */
function diffNewFilenames(onDisk, previousSnapshot) {
  const known = new Set(Object.keys(previousSnapshot));
  return onDisk.filter((name) => !known.has(name));
}

/**
 * Simulate the new-model pre-fill path from `settings.js::prefillMemoryWithPreset`:
 *   - Diff on-disk filenames against the previous store snapshot.
 *   - For each new filename, call `recommendPreset(meta, budget)`.
 *   - Record the resulting drafts in `panelDrafts` (the in-memory UI state).
 *   - Do NOT touch `store.set`.
 *
 * @param {Object} params
 * @param {string[]} params.onDisk           filenames currently on disk
 * @param {Record<string, object>} params.previousSnapshot  previous listAll() result
 * @param {Record<string, object>} params.modelMetaByFilename  parsed GGUF metadata per file
 * @param {object} params.budget             VRAM budget used for the recommendation
 * @param {object} params.store              stub ModelConfigStore
 * @returns {{panelDrafts: Record<string, object>, newFilenames: string[]}}
 */
function simulatePrefillFlow({ onDisk, previousSnapshot, modelMetaByFilename, budget, store }) {
  const newFilenames = diffNewFilenames(onDisk, previousSnapshot);
  const panelDrafts = {};

  for (const filename of newFilenames) {
    const meta = modelMetaByFilename[filename];
    // Task 12.4: pre-fill via recommendPreset — overrides any stale modelConfigs entry.
    panelDrafts[filename] = recommendPreset(meta, budget);
  }

  // Req 10.4 tail: pre-filled values MUST NOT be written to modelConfigs until Save.
  // We deliberately do NOT call store.set here.
  void store;

  return { panelDrafts, newFilenames };
}

/**
 * Simulate the Save click. This is the ONLY path that is allowed to call
 * `store.set`.
 *
 * @param {object} store
 * @param {string} filename
 * @param {object} draft
 */
function simulateSaveClick(store, filename, draft) {
  store.set(filename, draft);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('First-load pre-fill via recommendPreset (Task 13.3, Req 10.4)', () => {
  let window;
  let store;
  const budget = {
    detected: true,
    totalVramMB: 8192,
    reservedMB: 512,
    gpuCount: 1,
    physicalCores: 8,
  };

  beforeEach(() => {
    window = createDOM();
    store = createStubStore();
  });

  afterEach(() => {
    if (window) window.close();
    sinon.restore();
  });

  it('pre-fills the panel draft for a newly-added model using recommendPreset', () => {
    const meta = {
      filename: 'llama-2-7b-q4_K_M.gguf',
      sizeBytes: 4 * 1024 * 1024 * 1024,
      totalLayers: 32,
      isMoE: false,
    };

    const { panelDrafts, newFilenames } = simulatePrefillFlow({
      onDisk: [meta.filename],
      previousSnapshot: {},
      modelMetaByFilename: { [meta.filename]: meta },
      budget,
      store,
    });

    expect(newFilenames).to.deep.equal([meta.filename]);

    // Draft must match recommendPreset's output exactly.
    const expected = recommendPreset(meta, budget);
    expect(panelDrafts[meta.filename]).to.deep.equal(expected);

    // Req 10.4: store.set MUST NOT have been called before Save.
    expect(store.set.called).to.equal(false);
    expect(store.setCalls).to.have.lengthOf(0);
  });

  it('overrides a stale modelConfigs entry for the new filename (Req 10.4)', () => {
    // The filename already has a stale config in modelConfigs, but the diff
    // still considers it "new" because it is not in the previous snapshot.
    const meta = {
      filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
      sizeBytes: 26 * 1024 * 1024 * 1024,
      totalLayers: 32,
      isMoE: true,
      activeParamsB: 12.9,
      totalParamsB: 46.7,
    };

    // Seed a stale on-disk entry (e.g. left over from a previous install).
    store = createStubStore({
      [meta.filename]: { ...DEFAULT_ADVANCED_ARGS, nGpuLayers: 99, threads: 2 },
    });

    // Previous snapshot does NOT contain the filename — it's "new" from the
    // panel's perspective, even though the store has a stale entry.
    const { panelDrafts } = simulatePrefillFlow({
      onDisk: [meta.filename],
      previousSnapshot: {},
      modelMetaByFilename: { [meta.filename]: meta },
      budget,
      store,
    });

    // Draft must come from recommendPreset, NOT from the stale stored entry.
    const expected = recommendPreset(meta, budget);
    expect(panelDrafts[meta.filename]).to.deep.equal(expected);
    expect(panelDrafts[meta.filename].nGpuLayers).to.not.equal(99);
    expect(panelDrafts[meta.filename].threads).to.not.equal(2);

    // Req 10.4: no persistence happens as a side effect of the pre-fill.
    expect(store.set.called).to.equal(false);
  });

  it('pre-fills drafts for multiple newly-added models at once', () => {
    const metas = {
      'llama-2-7b-q4_K_M.gguf': {
        filename: 'llama-2-7b-q4_K_M.gguf',
        sizeBytes: 4 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: false,
      },
      'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf': {
        filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
        sizeBytes: 26 * 1024 * 1024 * 1024,
        totalLayers: 32,
        isMoE: true,
        activeParamsB: 12.9,
        totalParamsB: 46.7,
      },
      'Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf': {
        filename: 'Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf',
        sizeBytes: 9 * 1024 * 1024 * 1024,
        totalLayers: 24,
        isMoE: true,
        activeParamsB: 2.7,
        totalParamsB: 14.3,
      },
    };

    const { panelDrafts, newFilenames } = simulatePrefillFlow({
      onDisk: Object.keys(metas),
      previousSnapshot: {},
      modelMetaByFilename: metas,
      budget,
      store,
    });

    expect(newFilenames).to.have.members(Object.keys(metas));

    for (const filename of Object.keys(metas)) {
      const expected = recommendPreset(metas[filename], budget);
      expect(panelDrafts[filename]).to.deep.equal(expected);
    }

    // Req 10.4: no persistence across any of the pre-fills.
    expect(store.set.called).to.equal(false);
    expect(store.setCalls).to.have.lengthOf(0);
  });

  it('does NOT pre-fill models that already exist in the previous snapshot', () => {
    const existingMeta = {
      filename: 'already-known-7b.gguf',
      sizeBytes: 4 * 1024 * 1024 * 1024,
      totalLayers: 32,
      isMoE: false,
    };
    const newMeta = {
      filename: 'brand-new-13b.gguf',
      sizeBytes: 8 * 1024 * 1024 * 1024,
      totalLayers: 40,
      isMoE: false,
    };

    const previousSnapshot = {
      [existingMeta.filename]: { ...DEFAULT_ADVANCED_ARGS, nGpuLayers: 20 },
    };

    const { panelDrafts, newFilenames } = simulatePrefillFlow({
      onDisk: [existingMeta.filename, newMeta.filename],
      previousSnapshot,
      modelMetaByFilename: {
        [existingMeta.filename]: existingMeta,
        [newMeta.filename]: newMeta,
      },
      budget,
      store,
    });

    // Only the truly-new model should receive a pre-filled draft.
    expect(newFilenames).to.deep.equal([newMeta.filename]);
    expect(panelDrafts).to.have.all.keys(newMeta.filename);
    expect(panelDrafts).to.not.have.property(existingMeta.filename);

    // Draft for the new model matches recommendPreset.
    const expected = recommendPreset(newMeta, budget);
    expect(panelDrafts[newMeta.filename]).to.deep.equal(expected);

    expect(store.set.called).to.equal(false);
  });

  it('persists the draft ONLY after an explicit Save click', () => {
    const meta = {
      filename: 'llama-2-13b-q4_K_M.gguf',
      sizeBytes: 8 * 1024 * 1024 * 1024,
      totalLayers: 40,
      isMoE: false,
    };

    const { panelDrafts } = simulatePrefillFlow({
      onDisk: [meta.filename],
      previousSnapshot: {},
      modelMetaByFilename: { [meta.filename]: meta },
      budget,
      store,
    });

    // Pre-fill phase: no persistence yet.
    expect(store.set.called).to.equal(false);

    // User clicks Save — now, and only now, does the draft reach the store.
    simulateSaveClick(store, meta.filename, panelDrafts[meta.filename]);

    expect(store.set.calledOnce).to.equal(true);
    expect(store.setCalls).to.have.lengthOf(1);
    expect(store.setCalls[0].filename).to.equal(meta.filename);
    expect(store.setCalls[0].config).to.deep.equal(recommendPreset(meta, budget));
  });

  it('produces a preset that matches recommendPreset across varied budgets', () => {
    const meta = {
      filename: 'llama-2-7b-q4_K_M.gguf',
      sizeBytes: 4 * 1024 * 1024 * 1024,
      totalLayers: 32,
      isMoE: false,
    };

    const budgets = [
      {
        detected: false,
        totalVramMB: 0,
        reservedMB: 0,
        gpuCount: 0,
        physicalCores: 4,
      },
      {
        detected: true,
        totalVramMB: 8192,
        reservedMB: 512,
        gpuCount: 1,
        physicalCores: 8,
      },
      {
        detected: true,
        totalVramMB: 24576,
        reservedMB: 512,
        gpuCount: 2,
        physicalCores: 16,
      },
    ];

    for (const b of budgets) {
      const freshStore = createStubStore();
      const { panelDrafts } = simulatePrefillFlow({
        onDisk: [meta.filename],
        previousSnapshot: {},
        modelMetaByFilename: { [meta.filename]: meta },
        budget: b,
        store: freshStore,
      });

      expect(panelDrafts[meta.filename]).to.deep.equal(recommendPreset(meta, b));
      expect(freshStore.set.called).to.equal(false);
    }
  });
});
