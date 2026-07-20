/* eslint-env node, mocha */
/**
 * Property Test P59: `classifyModel` MoE/dense partition consistency
 *
 * For every `modelMeta` in the documented input domain,
 *   - `classifyModel(modelMeta).startsWith('moe-')   === detectMoE(modelMeta)`
 *   - `classifyModel(modelMeta).startsWith('dense-') === !detectMoE(modelMeta)`
 *
 * In other words, the four output classes
 *   { 'dense-small', 'dense-large', 'moe-small', 'moe-large' }
 * split exactly along the `detectMoE` boundary: the `'moe-'` prefix class
 * membership is logically equivalent to `detectMoE === true`, and the
 * `'dense-'` prefix class membership is equivalent to `detectMoE === false`.
 *
 * This is the design-§8 "MoE/dense partition" invariant (Req 8.2, 8.3).
 *
 * Validates: Requirements 8.2, 8.3
 *
 * Strategy:
 *   Draw `modelMeta` values from `arbModelMeta`, which samples across the
 *   three shapes defined in `tests/helpers/arb-model-meta.js`:
 *     1. full GGUF (all fields present, architecture+filename consistent
 *        with the `isMoE` flag),
 *     2. filename-only (forces `detectMoE` onto the `MOE_FILENAME_RE` and
 *        `classifyModel` onto its size-fallback branches),
 *     3. explicit MoE override (`isMoE: true` with mixed architectures /
 *        filenames, so the explicit-flag branch wins).
 *   This guarantees all three decision branches of `detectMoE` are
 *   exercised within a default 100-run fast-check campaign.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  classifyModel,
  detectMoE,
} = require('../../model-classifier');

const {
  arbModelMeta,
} = require('../helpers/arb-model-meta');

/**
 * The four legal outputs of `classifyModel`.
 * @type {ReadonlySet<string>}
 */
const CLASSES = new Set(['dense-small', 'dense-large', 'moe-small', 'moe-large']);

describe('P59: classifyModel MoE/dense partition consistency', () => {
  // ---------------------------------------------------------------------------
  // Example-style sanity checks pinning the partition invariant on canonical
  // inputs. These fail-fast on obvious regressions before the randomised
  // run reaches the property body.
  // ---------------------------------------------------------------------------

  describe('example: canonical GGUF filenames', () => {
    it("classifies 'llama-2-7b-q4_K_M.gguf' as 'dense-*' (detectMoE=false)", () => {
      const meta = { filename: 'llama-2-7b-q4_K_M.gguf' };
      expect(detectMoE(meta)).to.equal(false);
      expect(classifyModel(meta).startsWith('dense-')).to.equal(true);
    });

    it("classifies 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf' as 'moe-*' (detectMoE=true)", () => {
      const meta = { filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf' };
      expect(detectMoE(meta)).to.equal(true);
      expect(classifyModel(meta).startsWith('moe-')).to.equal(true);
    });

    it('honours explicit isMoE=true override (class must be moe-*)', () => {
      const meta = {
        filename: 'llama-2-7b-q4_K_M.gguf', // dense-looking filename
        architecture: 'llama',              // dense architecture
        isMoE: true,                        // explicit override wins
      };
      expect(detectMoE(meta)).to.equal(true);
      expect(classifyModel(meta).startsWith('moe-')).to.equal(true);
    });

    it('honours explicit isMoE=false override (class must be dense-*)', () => {
      const meta = {
        filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf', // MoE-looking filename
        architecture: 'mixtral',                            // MoE architecture
        isMoE: false,                                       // explicit override wins
      };
      expect(detectMoE(meta)).to.equal(false);
      expect(classifyModel(meta).startsWith('dense-')).to.equal(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Property-based check: the partition invariant holds universally over
  // the full `arbModelMeta` sample space.
  // ---------------------------------------------------------------------------

  it("classifyModel(m).startsWith('moe-') iff detectMoE(m) === true", () => {
    fc.assert(
      fc.property(arbModelMeta, (meta) => {
        const cls = classifyModel(meta);
        const isMoE = detectMoE(meta);

        // Membership: the class is always one of the four legal values.
        expect(CLASSES.has(cls)).to.equal(
          true,
          `classifyModel returned unexpected value ${JSON.stringify(cls)}`,
        );

        // Partition invariants (both directions of the biconditional).
        expect(cls.startsWith('moe-')).to.equal(
          isMoE,
          `expected startsWith('moe-') === detectMoE for meta=${JSON.stringify(meta)}; got class=${cls}, isMoE=${isMoE}`,
        );
        expect(cls.startsWith('dense-')).to.equal(
          !isMoE,
          `expected startsWith('dense-') === !detectMoE for meta=${JSON.stringify(meta)}; got class=${cls}, isMoE=${isMoE}`,
        );
      }),
      // Default fast-check runs (100) per the task description.
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // Exhaustiveness check: the set of prefixes seen over the sample space
  // really is exactly {"moe-", "dense-"} and nothing else. This catches a
  // hypothetical refactor that introduces a third prefix without updating
  // the partition invariant.
  // ---------------------------------------------------------------------------

  it('produces exactly the two prefixes "moe-" and "dense-"', () => {
    fc.assert(
      fc.property(arbModelMeta, (meta) => {
        const cls = classifyModel(meta);
        const prefix = cls.split('-')[0] + '-';
        expect(prefix).to.be.oneOf(['moe-', 'dense-']);
      }),
      { numRuns: 100 },
    );
  });
});
