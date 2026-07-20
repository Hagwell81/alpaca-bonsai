/* eslint-env node, mocha */
/**
 * Property Test P58: `classifyModel` determinism and membership
 *
 * For any `modelMeta` drawn from the documented input domain
 * (`tests/helpers/arb-model-meta.js`):
 *
 *   1. `classifyModel(modelMeta)` returns a value in the four-element set
 *        { 'dense-small', 'dense-large', 'moe-small', 'moe-large' }.
 *   2. Two successive calls with the same input return the same value
 *        (pure-function determinism).
 *
 * Validates: Requirements 8.1, 8.5
 *
 * Strategy:
 *   - Use `arbModelMeta` (unified arbitrary covering all three shapes: full
 *     GGUF metadata, filename-only, and explicit MoE override) so every
 *     branch of `detectMoE` / `inferTotalParamsB` / `classifyModel` can be
 *     reached within a 100-run campaign.
 *   - Additionally pin a handful of canonical filenames as example-style
 *     sanity checks so a regression produces a targeted failure before the
 *     property-based runs.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { classifyModel } = require('../../model-classifier');
const { arbModelMeta } = require('../helpers/arb-model-meta');

/** The four allowed class labels from Req 8.1. */
const ALLOWED_CLASSES = Object.freeze([
  'dense-small',
  'dense-large',
  'moe-small',
  'moe-large',
]);

describe('P58: classifyModel determinism and membership', () => {
  // -------------------------------------------------------------------------
  // Example-style sanity checks. These pin a few canonical filenames so a
  // regression in the table surfaces as a targeted failure rather than as a
  // fast-check counterexample.
  // -------------------------------------------------------------------------

  describe('examples: canonical filenames land in the four-element set', () => {
    const examples = [
      { filename: 'llama-2-7b-q4_K_M.gguf' },
      { filename: 'Mixtral-8x7B-Instruct-v0.1.Q4_K_M.gguf' },
      { filename: 'Qwen1.5-MoE-A2.7B-Chat.Q4_K_M.gguf' },
      { filename: 'deepseek-v2-chat.Q4_K_M.gguf' },
    ];

    for (const meta of examples) {
      it(`${meta.filename} classifies into an allowed class`, () => {
        const cls = classifyModel(meta);
        expect(ALLOWED_CLASSES).to.include(cls);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Property-based checks
  // -------------------------------------------------------------------------

  it('membership: classifyModel(m) is always one of the four allowed classes', () => {
    fc.assert(
      fc.property(arbModelMeta, (modelMeta) => {
        const cls = classifyModel(modelMeta);
        expect(ALLOWED_CLASSES).to.include(cls);
      }),
      // Default fast-check runs (100) per tasks.md.
      { numRuns: 100 },
    );
  });

  it('determinism: two successive calls return the same class', () => {
    fc.assert(
      fc.property(arbModelMeta, (modelMeta) => {
        const first = classifyModel(modelMeta);
        const second = classifyModel(modelMeta);
        expect(first).to.equal(second);
      }),
      { numRuns: 100 },
    );
  });
});
