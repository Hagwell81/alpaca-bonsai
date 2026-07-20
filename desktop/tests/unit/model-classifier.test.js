/**
 * Unit tests for model-classifier.js
 *
 * Covers the four exported helpers — `detectMoE`, `inferTotalParamsB`,
 * `inferTotalLayers`, and `classifyModel` — across the three documented
 * decision paths:
 *
 *   1. Metadata-first path (explicit fields on `modelMeta` win).
 *   2. Filename-only fallback (regex heuristics on `filename`).
 *   3. Size-fallback path (`sizeBytes` split at 8 GiB).
 *
 * Exercises the four canonical GGUF filenames called out in the task:
 *   - llama-2-7b-q4_K_M.gguf                       (dense 7B)
 *   - Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf       (MoE, filename-detected)
 *   - Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf           (MoE, filename-detected)
 *   - deepseek-v2-chat.Q4_K_M.gguf                 (MoE, filename-detected)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 (examples)
 */

'use strict';

const { expect } = require('chai');
const {
  MOE_ARCHITECTURES,
  MOE_FILENAME_RE,
  PARAM_COUNT_RE,
  detectMoE,
  inferTotalParamsB,
  inferTotalLayers,
  classifyModel,
} = require('../../model-classifier');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024;

// Canonical GGUF filenames from the task description.
const FN_LLAMA_7B        = 'llama-2-7b-q4_K_M.gguf';
const FN_MIXTRAL_8X7B    = 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf';
const FN_QWEN_MOE_A27B   = 'Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf';
const FN_DEEPSEEK_V2     = 'deepseek-v2-chat.Q4_K_M.gguf';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('model-classifier: exported constants', () => {
  it('MOE_ARCHITECTURES contains the design §3 set and is frozen', () => {
    expect(MOE_ARCHITECTURES).to.be.instanceOf(Set);
    for (const arch of [
      'qwen2_moe', 'mixtral', 'deepseek2', 'dbrx',
      'jamba', 'phimoe', 'granitemoe',
    ]) {
      expect(MOE_ARCHITECTURES.has(arch)).to.equal(true, `missing ${arch}`);
    }
    expect(Object.isFrozen(MOE_ARCHITECTURES)).to.equal(true);
  });

  it('MOE_FILENAME_RE is a case-insensitive RegExp', () => {
    expect(MOE_FILENAME_RE).to.be.instanceOf(RegExp);
    expect(MOE_FILENAME_RE.flags).to.include('i');
  });

  it('PARAM_COUNT_RE extracts decimal parameter counts from GGUF filenames', () => {
    expect(PARAM_COUNT_RE).to.be.instanceOf(RegExp);
    const m = PARAM_COUNT_RE.exec('llama-2-7b-q4_K_M.gguf');
    expect(m).to.not.equal(null);
    expect(m[1]).to.equal('7');
  });
});

// ---------------------------------------------------------------------------
// detectMoE
// ---------------------------------------------------------------------------

describe('detectMoE', () => {
  describe('non-object inputs are total (return false, never throw)', () => {
    const nonObjects = [null, undefined, 0, 1, '', 'moe', true, false, NaN];
    for (const value of nonObjects) {
      it(`returns false for ${String(value)}`, () => {
        expect(detectMoE(value)).to.equal(false);
      });
    }
  });

  describe('metadata-first path', () => {
    it('honours explicit isMoE === true even when architecture/filename disagree', () => {
      expect(detectMoE({
        isMoE: true,
        architecture: 'llama',
        filename: 'llama-2-7b-q4_K_M.gguf',
      })).to.equal(true);
    });

    it('honours explicit isMoE === false even when architecture/filename suggest MoE', () => {
      expect(detectMoE({
        isMoE: false,
        architecture: 'mixtral',
        filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf',
      })).to.equal(false);
    });

    it('ignores non-boolean isMoE and falls through to architecture lookup', () => {
      // A non-boolean value is not treated as an override.
      expect(detectMoE({
        isMoE: 'yes',
        architecture: 'Mixtral',
        filename: 'some-file.gguf',
      })).to.equal(true);
    });

    it('matches architecture case-insensitively against the MOE set', () => {
      for (const arch of ['MIXTRAL', 'Mixtral', 'DBRX', 'deepseek2', 'qwen2_moe']) {
        expect(detectMoE({ architecture: arch, filename: 'neutral.gguf' }))
          .to.equal(true, `architecture=${arch}`);
      }
    });

    it('returns false when architecture is a dense model and filename is neutral', () => {
      expect(detectMoE({ architecture: 'llama', filename: 'neutral.gguf' }))
        .to.equal(false);
    });
  });

  describe('filename-only fallback (canonical GGUF names)', () => {
    it('llama-2-7b-q4_K_M.gguf is not MoE', () => {
      expect(detectMoE({ filename: FN_LLAMA_7B })).to.equal(false);
    });

    it('Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf is MoE (matches "mixtral")', () => {
      expect(detectMoE({ filename: FN_MIXTRAL_8X7B })).to.equal(true);
    });

    it('Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf is MoE (matches "moe")', () => {
      expect(detectMoE({ filename: FN_QWEN_MOE_A27B })).to.equal(true);
    });

    it('deepseek-v2-chat.Q4_K_M.gguf is MoE (matches "deepseek-v2")', () => {
      expect(detectMoE({ filename: FN_DEEPSEEK_V2 })).to.equal(true);
    });

    it('returns false on empty object and empty filename', () => {
      expect(detectMoE({})).to.equal(false);
      expect(detectMoE({ filename: '' })).to.equal(false);
    });
  });
});

// ---------------------------------------------------------------------------
// inferTotalParamsB
// ---------------------------------------------------------------------------

describe('inferTotalParamsB', () => {
  describe('metadata-first path', () => {
    it('returns modelMeta.totalParamsB when it is a finite positive number', () => {
      expect(inferTotalParamsB({ totalParamsB: 47, filename: FN_MIXTRAL_8X7B }))
        .to.equal(47);
    });

    it('accepts decimal parameter counts (e.g. 2.7)', () => {
      expect(inferTotalParamsB({ totalParamsB: 2.7 })).to.equal(2.7);
    });

    it('ignores zero, negative, NaN, and Infinity in totalParamsB', () => {
      // Falls through to size-fallback (sizeBytes absent → 0 → < 8 GiB → 7).
      expect(inferTotalParamsB({ totalParamsB: 0 })).to.equal(7);
      expect(inferTotalParamsB({ totalParamsB: -5 })).to.equal(7);
      expect(inferTotalParamsB({ totalParamsB: NaN })).to.equal(7);
      expect(inferTotalParamsB({ totalParamsB: Infinity })).to.equal(7);
    });
  });

  describe('filename-only fallback via PARAM_COUNT_RE', () => {
    it('extracts 7 from llama-2-7b-q4_K_M.gguf', () => {
      expect(inferTotalParamsB({ filename: FN_LLAMA_7B })).to.equal(7);
    });

    it('extracts decimal numbers like 1.5b', () => {
      expect(inferTotalParamsB({ filename: 'phi-1.5b-q4_0.gguf' })).to.equal(1.5);
    });

    it('is case-insensitive on the trailing B/b sentinel', () => {
      expect(inferTotalParamsB({ filename: 'model-13B-chat.gguf' })).to.equal(13);
      expect(inferTotalParamsB({ filename: 'model-13b-chat.gguf' })).to.equal(13);
    });
  });

  describe('size-fallback path (regex miss)', () => {
    it('returns 7 when sizeBytes < 8 GiB and filename has no <N>B tag', () => {
      // The canonical Mixtral and Qwen-MoE names do not expose a <N>B tag
      // surrounded by '_' or '-' that the PARAM_COUNT_RE accepts, so both
      // fall through to the size-fallback branch.
      expect(inferTotalParamsB({
        filename: FN_MIXTRAL_8X7B,
        sizeBytes: 4 * GIB,
      })).to.equal(7);
      expect(inferTotalParamsB({
        filename: FN_QWEN_MOE_A27B,
        sizeBytes: 4 * GIB,
      })).to.equal(7);
    });

    it('returns 14 when sizeBytes >= 8 GiB and filename has no <N>B tag', () => {
      expect(inferTotalParamsB({
        filename: FN_DEEPSEEK_V2,
        sizeBytes: 20 * GIB,
      })).to.equal(14);
      expect(inferTotalParamsB({
        filename: FN_MIXTRAL_8X7B,
        sizeBytes: 26 * GIB,
      })).to.equal(14);
    });

    it('uses the boundary 8 GiB exactly (< 8 GiB → 7, >= 8 GiB → 14)', () => {
      expect(inferTotalParamsB({ filename: 'x.gguf', sizeBytes: 8 * GIB - 1 }))
        .to.equal(7);
      expect(inferTotalParamsB({ filename: 'x.gguf', sizeBytes: 8 * GIB }))
        .to.equal(14);
    });

    it('returns 7 for a missing sizeBytes (treated as 0)', () => {
      expect(inferTotalParamsB({ filename: 'x.gguf' })).to.equal(7);
      expect(inferTotalParamsB({})).to.equal(7);
    });
  });

  it('is total on null and undefined (returns the default 7)', () => {
    expect(inferTotalParamsB(null)).to.equal(7);
    expect(inferTotalParamsB(undefined)).to.equal(7);
  });
});

// ---------------------------------------------------------------------------
// inferTotalLayers
// ---------------------------------------------------------------------------

describe('inferTotalLayers', () => {
  describe('metadata-first path', () => {
    it('returns modelMeta.totalLayers when it is a positive integer', () => {
      expect(inferTotalLayers({ totalLayers: 32, totalParamsB: 70 })).to.equal(32);
      expect(inferTotalLayers({ totalLayers: 1 })).to.equal(1);
    });

    it('ignores non-integer, zero, and negative totalLayers', () => {
      // Falls through to the heuristic; with no sizeBytes/filename,
      // totalParamsB defaults to 7 → heuristic returns 32.
      expect(inferTotalLayers({ totalLayers: 32.5 })).to.equal(32);
      expect(inferTotalLayers({ totalLayers: 0 })).to.equal(32);
      expect(inferTotalLayers({ totalLayers: -1 })).to.equal(32);
    });
  });

  describe('heuristic table keyed on inferred totalParamsB', () => {
    it('returns 26 when pb <= 3', () => {
      expect(inferTotalLayers({ totalParamsB: 1 })).to.equal(26);
      expect(inferTotalLayers({ totalParamsB: 3 })).to.equal(26);
    });

    it('returns 32 when 3 < pb <= 8', () => {
      expect(inferTotalLayers({ totalParamsB: 3.01 })).to.equal(32);
      expect(inferTotalLayers({ totalParamsB: 7 })).to.equal(32);
      expect(inferTotalLayers({ totalParamsB: 8 })).to.equal(32);
    });

    it('returns 40 when 8 < pb <= 13', () => {
      expect(inferTotalLayers({ totalParamsB: 8.01 })).to.equal(40);
      expect(inferTotalLayers({ totalParamsB: 13 })).to.equal(40);
    });

    it('returns 48 when 13 < pb <= 35', () => {
      expect(inferTotalLayers({ totalParamsB: 13.01 })).to.equal(48);
      expect(inferTotalLayers({ totalParamsB: 35 })).to.equal(48);
    });

    it('returns 80 when 35 < pb <= 70', () => {
      expect(inferTotalLayers({ totalParamsB: 35.01 })).to.equal(80);
      expect(inferTotalLayers({ totalParamsB: 70 })).to.equal(80);
    });

    it('returns 96 when pb > 70', () => {
      expect(inferTotalLayers({ totalParamsB: 70.01 })).to.equal(96);
      expect(inferTotalLayers({ totalParamsB: 180 })).to.equal(96);
    });
  });

  describe('size-fallback path', () => {
    it('returns 32 for < 8 GiB (pb=7 via size-fallback)', () => {
      expect(inferTotalLayers({ filename: 'x.gguf', sizeBytes: 4 * GIB }))
        .to.equal(32);
    });

    it('returns 48 for >= 8 GiB (pb=14 via size-fallback)', () => {
      expect(inferTotalLayers({ filename: 'x.gguf', sizeBytes: 20 * GIB }))
        .to.equal(48);
    });
  });

  it('is total on null and undefined (returns 32 for the default pb=7)', () => {
    expect(inferTotalLayers(null)).to.equal(32);
    expect(inferTotalLayers(undefined)).to.equal(32);
  });
});

// ---------------------------------------------------------------------------
// classifyModel
// ---------------------------------------------------------------------------

describe('classifyModel', () => {
  describe('canonical GGUF filenames with realistic sizeBytes', () => {
    it('llama-2-7b-q4_K_M.gguf (filename regex → 7B) → dense-small', () => {
      expect(classifyModel({
        filename: FN_LLAMA_7B,
        sizeBytes: 4 * GIB, // ~4 GiB for Q4_K_M
      })).to.equal('dense-small');
    });

    it('Mixtral-8x7B (size-fallback → 14B, MoE) → moe-small', () => {
      // Mixtral 8x7B Q4_K_M is ~26 GiB; size >= 8 GiB → pb = 14;
      // MoE since filename matches "mixtral"; 14 <= 30 → moe-small.
      expect(classifyModel({
        filename: FN_MIXTRAL_8X7B,
        sizeBytes: 26 * GIB,
      })).to.equal('moe-small');
    });

    it('Qwen1.5-MoE-A2.7B (size-fallback → 14B, MoE) → moe-small', () => {
      expect(classifyModel({
        filename: FN_QWEN_MOE_A27B,
        sizeBytes: 10 * GIB,
      })).to.equal('moe-small');
    });

    it('deepseek-v2 (size-fallback → 14B, MoE) → moe-small without metadata', () => {
      // Without explicit totalParamsB, the classifier only sees the
      // size-fallback value (14B). It is up to callers to supply real
      // metadata when they know the true active/total params.
      expect(classifyModel({
        filename: FN_DEEPSEEK_V2,
        sizeBytes: 80 * GIB,
      })).to.equal('moe-small');
    });
  });

  describe('metadata-first path (explicit totalParamsB + isMoE)', () => {
    it('isMoE=false and totalParamsB=7 → dense-small', () => {
      expect(classifyModel({
        filename: FN_LLAMA_7B,
        isMoE: false,
        totalParamsB: 7,
      })).to.equal('dense-small');
    });

    it('isMoE=false and totalParamsB=70 → dense-large', () => {
      expect(classifyModel({
        filename: 'llama-2-70b-q4_K_M.gguf',
        isMoE: false,
        totalParamsB: 70,
      })).to.equal('dense-large');
    });

    it('isMoE=true and totalParamsB=30 → moe-small (boundary)', () => {
      expect(classifyModel({
        filename: FN_MIXTRAL_8X7B,
        isMoE: true,
        totalParamsB: 30,
      })).to.equal('moe-small');
    });

    it('isMoE=true and totalParamsB=236 (DeepSeek V2) → moe-large', () => {
      // Real DeepSeek V2 values supplied by a GGUF-aware caller.
      expect(classifyModel({
        filename: FN_DEEPSEEK_V2,
        isMoE: true,
        totalParamsB: 236,
        activeParamsB: 21,
      })).to.equal('moe-large');
    });

    it('isMoE=true and totalParamsB=47 (Mixtral 8x7B) → moe-large', () => {
      expect(classifyModel({
        filename: FN_MIXTRAL_8X7B,
        isMoE: true,
        totalParamsB: 47,
      })).to.equal('moe-large');
    });
  });

  describe('size class boundaries', () => {
    it('dense/small boundary at exactly 13B → dense-small', () => {
      expect(classifyModel({
        filename: 'x.gguf',
        isMoE: false,
        totalParamsB: 13,
      })).to.equal('dense-small');
    });

    it('dense/large strictly above 13B → dense-large', () => {
      expect(classifyModel({
        filename: 'x.gguf',
        isMoE: false,
        totalParamsB: 13.01,
      })).to.equal('dense-large');
    });

    it('moe/small boundary at exactly 30B → moe-small', () => {
      expect(classifyModel({
        filename: 'x.gguf',
        isMoE: true,
        totalParamsB: 30,
      })).to.equal('moe-small');
    });

    it('moe/large strictly above 30B → moe-large', () => {
      expect(classifyModel({
        filename: 'x.gguf',
        isMoE: true,
        totalParamsB: 30.01,
      })).to.equal('moe-large');
    });
  });

  describe('size-fallback path (no metadata, no <N>B filename tag)', () => {
    it('non-MoE, sizeBytes < 8 GiB → dense-small (pb=7)', () => {
      expect(classifyModel({
        filename: 'mystery-model.gguf',
        sizeBytes: 4 * GIB,
      })).to.equal('dense-small');
    });

    it('non-MoE, sizeBytes >= 8 GiB → dense-large (pb=14 > 13)', () => {
      // pb=14 is strictly greater than 13, so the classifier lands in
      // dense-large under the size-fallback path.
      expect(classifyModel({
        filename: 'mystery-model.gguf',
        sizeBytes: 20 * GIB,
      })).to.equal('dense-large');
    });

    it('MoE filename, sizeBytes < 8 GiB → moe-small (pb=7)', () => {
      expect(classifyModel({
        filename: 'custom-moe-model.gguf',
        sizeBytes: 4 * GIB,
      })).to.equal('moe-small');
    });
  });

  it('is deterministic — two successive calls return the same class', () => {
    const meta = {
      filename: FN_MIXTRAL_8X7B,
      isMoE: true,
      totalParamsB: 47,
      sizeBytes: 26 * GIB,
    };
    expect(classifyModel(meta)).to.equal(classifyModel(meta));
  });

  it('is total on null and undefined (returns dense-small for pb=7)', () => {
    expect(classifyModel(null)).to.equal('dense-small');
    expect(classifyModel(undefined)).to.equal('dense-small');
  });
});
