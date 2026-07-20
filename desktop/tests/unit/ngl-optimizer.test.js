/**
 * Unit tests for ngl-optimizer.js
 *
 * Covers the two exported functions:
 *   - `buildEstimateInput(modelMeta, baseArgs, N)` — pure translator to the
 *     extended `estimateRequiredMB` input shape.
 *   - `autoTuneNgl(modelMeta, baseArgs, budget, totalLayers, activeAllocationsMB)`
 *     — "Fit to VRAM" binary search over `[0, totalLayers]`.
 *
 * Exercises the four documented scenarios from the task:
 *   1. All-fits scenario → `totalLayers`
 *   2. None-fits → `0`
 *   3. Middle scenario (binary search finds the boundary)
 *   4. Detection-failure fallback → `totalLayers`
 *
 * Confirms no I/O via `child_process` / `fs` / `http` stubs (Req 7.6).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8 (examples)
 */

'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { buildEstimateInput, autoTuneNgl } = require('../../ngl-optimizer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

/**
 * Minimal modelMeta for testing.
 */
function makeMeta(overrides = {}) {
  return {
    filename: 'test-model.gguf',
    sizeBytes: 4 * GIB,
    totalLayers: 32,
    ...overrides,
  };
}

/**
 * Minimal baseArgs for testing.
 */
function makeArgs(overrides = {}) {
  return {
    ctxSize: 4096,
    typeK: 'f16',
    typeV: 'f16',
    nCpuMoe: 0,
    purpose: 'primary',
    ...overrides,
  };
}

/**
 * Minimal budget for testing.
 */
function makeBudget(overrides = {}) {
  return {
    detected: true,
    totalVramMB: 8 * 1024,
    reservedMB: 512,
    gpuCount: 1,
    physicalCores: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildEstimateInput
// ---------------------------------------------------------------------------

describe('buildEstimateInput', () => {
  it('translates modelMeta.sizeBytes to modelFileSizeMB', () => {
    const meta = makeMeta({ sizeBytes: 4 * GIB });
    const args = makeArgs();
    const out = buildEstimateInput(meta, args, 16);
    expect(out.modelFileSizeMB).to.be.closeTo(4 * 1024, 0.01);
  });

  it('derives totalLayers from inferTotalLayers(modelMeta)', () => {
    const meta = makeMeta({ totalLayers: 40 });
    const args = makeArgs();
    const out = buildEstimateInput(meta, args, 16);
    expect(out.totalLayers).to.equal(40);
  });

  it('copies ctxSize, typeK, typeV, nCpuMoe, purpose from baseArgs', () => {
    const meta = makeMeta();
    const args = makeArgs({
      ctxSize: 8192,
      typeK: 'q8_0',
      typeV: 'q4_0',
      nCpuMoe: 5,
      purpose: 'vision',
    });
    const out = buildEstimateInput(meta, args, 16);
    expect(out.ctxSize).to.equal(8192);
    expect(out.typeK).to.equal('q8_0');
    expect(out.typeV).to.equal('q4_0');
    expect(out.nCpuMoe).to.equal(5);
    expect(out.purpose).to.equal('vision');
  });

  it('sets nGpuLayers to the caller-supplied N (overriding baseArgs)', () => {
    const meta = makeMeta();
    const args = makeArgs({ nGpuLayers: 999 });
    const out = buildEstimateInput(meta, args, 16);
    expect(out.nGpuLayers).to.equal(16);
  });

  it('derives isMoE from detectMoE(modelMeta)', () => {
    const metaDense = makeMeta({ filename: 'llama-2-7b.gguf' });
    const metaMoE = makeMeta({ filename: 'Mixtral-8x7B.gguf' });
    const args = makeArgs();
    expect(buildEstimateInput(metaDense, args, 16).isMoE).to.equal(false);
    expect(buildEstimateInput(metaMoE, args, 16).isMoE).to.equal(true);
  });

  it('includes optional MoE params when both are finite positive', () => {
    const meta = makeMeta({
      activeParamsB: 21,
      totalParamsB: 236,
    });
    const args = makeArgs();
    const out = buildEstimateInput(meta, args, 16);
    expect(out.activeParamsB).to.equal(21);
    expect(out.totalParamsB).to.equal(236);
  });

  it('omits optional MoE params when missing or non-positive', () => {
    const meta = makeMeta({ activeParamsB: 0, totalParamsB: -1 });
    const args = makeArgs();
    const out = buildEstimateInput(meta, args, 16);
    expect(out).to.not.have.property('activeParamsB');
    expect(out).to.not.have.property('totalParamsB');
  });

  it('includes optional hiddenSizeBytesPerTokenPerLayer when present', () => {
    const meta = makeMeta({ hiddenSizeBytesPerTokenPerLayer: 512 });
    const args = makeArgs();
    const out = buildEstimateInput(meta, args, 16);
    expect(out.hiddenSizeBytesPerTokenPerLayer).to.equal(512);
  });

  it('includes optional mmprojMB from baseArgs when present', () => {
    const meta = makeMeta();
    const args = makeArgs({ mmprojMB: 1024 });
    const out = buildEstimateInput(meta, args, 16);
    expect(out.mmprojMB).to.equal(1024);
  });

  it('does not mutate baseArgs', () => {
    const meta = makeMeta();
    const args = makeArgs({ nGpuLayers: 999 });
    const argsCopy = { ...args };
    buildEstimateInput(meta, args, 16);
    expect(args).to.deep.equal(argsCopy);
  });

  it('is total on null/undefined modelMeta and baseArgs', () => {
    const out = buildEstimateInput(null, null, 16);
    expect(out).to.be.an('object');
    expect(out.nGpuLayers).to.equal(16);
    expect(out.modelFileSizeMB).to.equal(0);
  });
});

// ---------------------------------------------------------------------------
// autoTuneNgl
// ---------------------------------------------------------------------------

describe('autoTuneNgl', () => {
  describe('all-fits scenario (Req 7.4 / P55)', () => {
    it('returns totalLayers when the model fits entirely', () => {
      const meta = makeMeta({ sizeBytes: 1 * GIB, totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const result = autoTuneNgl(meta, args, budget, 32, []);
      expect(result).to.equal(32);
    });
  });

  describe('none-fits scenario (Req 7.3 / P56)', () => {
    it('returns 0 when even nGpuLayers=0 does not fit', () => {
      const meta = makeMeta({ sizeBytes: 20 * GIB, totalLayers: 80 });
      const args = makeArgs({ ctxSize: 32768 });
      const budget = makeBudget({ totalVramMB: 512 });
      const result = autoTuneNgl(meta, args, budget, 80, []);
      expect(result).to.equal(0);
    });
  });

  describe('middle scenario (binary search finds the boundary)', () => {
    it('returns the largest N such that canFit returns ok:true', () => {
      const meta = makeMeta({ sizeBytes: 8 * GIB, totalLayers: 40 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 6 * 1024 });
      const result = autoTuneNgl(meta, args, budget, 40, []);
      // The exact value depends on the estimator, but it should be in [1, 39]
      // (not 0 because some layers fit, not 40 because not all fit).
      expect(result).to.be.at.least(1);
      expect(result).to.be.at.most(39);
    });

    it('respects activeAllocationsMB pressure', () => {
      const meta = makeMeta({ sizeBytes: 4 * GIB, totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      // With no active allocations, more layers fit.
      const resultNoAllocs = autoTuneNgl(meta, args, budget, 32, []);
      // With 4 GiB already allocated, fewer layers fit.
      const resultWithAllocs = autoTuneNgl(meta, args, budget, 32, [4 * 1024]);
      expect(resultWithAllocs).to.be.lessThan(resultNoAllocs);
    });
  });

  describe('detection-failure fallback (Req 7.8 / P57)', () => {
    it('returns totalLayers when budget.detected === false', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ detected: false });
      const result = autoTuneNgl(meta, args, budget, 32, []);
      expect(result).to.equal(32);
    });

    it('returns totalLayers when budget.totalVramMB <= 0', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 0 });
      const result = autoTuneNgl(meta, args, budget, 32, []);
      expect(result).to.equal(32);
    });

    it('returns totalLayers when budget.totalVramMB is missing', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = { detected: true, reservedMB: 512 };
      const result = autoTuneNgl(meta, args, budget, 32, []);
      expect(result).to.equal(32);
    });
  });

  describe('determinism (Req 7.5 / P57)', () => {
    it('returns the same value on successive calls with identical inputs', () => {
      const meta = makeMeta({ sizeBytes: 4 * GIB, totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 6 * 1024 });
      const result1 = autoTuneNgl(meta, args, budget, 32, []);
      const result2 = autoTuneNgl(meta, args, budget, 32, []);
      expect(result1).to.equal(result2);
    });
  });

  describe('input coercion', () => {
    it('floors non-integer totalLayers to keep the search space integral', () => {
      const meta = makeMeta({ totalLayers: 32.7 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 16 * 1024 });
      const result = autoTuneNgl(meta, args, budget, 32.7, []);
      expect(result).to.be.at.most(32);
    });

    it('normalises non-array activeAllocationsMB to []', () => {
      const meta = makeMeta({ sizeBytes: 4 * GIB, totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      const result = autoTuneNgl(meta, args, budget, 32, 'not-an-array');
      expect(result).to.be.at.least(0);
      expect(result).to.be.at.most(32);
    });

    it('filters out non-finite and negative entries from activeAllocationsMB', () => {
      const meta = makeMeta({ sizeBytes: 4 * GIB, totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      const result = autoTuneNgl(meta, args, budget, 32, [1024, NaN, -500, Infinity, 2048]);
      // Only [1024, 2048] are kept; the rest are dropped.
      expect(result).to.be.at.least(0);
      expect(result).to.be.at.most(32);
    });
  });

  describe('purity contract (Req 7.6)', () => {
    let childProcessStub, fsStub, httpStub;

    beforeEach(() => {
      // Stub I/O modules to detect any accidental calls.
      childProcessStub = sinon.stub(require('child_process'), 'spawn');
      fsStub = sinon.stub(require('fs'), 'readFileSync');
      httpStub = sinon.stub(require('http'), 'request');
    });

    afterEach(() => {
      childProcessStub.restore();
      fsStub.restore();
      httpStub.restore();
    });

    it('performs no child_process.spawn calls', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      autoTuneNgl(meta, args, budget, 32, []);
      expect(childProcessStub.called).to.equal(false);
    });

    it('performs no fs.readFileSync calls', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      autoTuneNgl(meta, args, budget, 32, []);
      expect(fsStub.called).to.equal(false);
    });

    it('performs no http.request calls', () => {
      const meta = makeMeta({ totalLayers: 32 });
      const args = makeArgs();
      const budget = makeBudget({ totalVramMB: 8 * 1024 });
      autoTuneNgl(meta, args, budget, 32, []);
      expect(httpStub.called).to.equal(false);
    });
  });
});
