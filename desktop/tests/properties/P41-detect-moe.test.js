/* eslint-env node, mocha */
/**
 * Property Test P41: `detectMoE` determinism and oracle
 *
 * For any `ModelMeta` value in the documented input domain (plus the
 * totality extensions — `null`, `undefined`, and non-object inputs),
 * `detectMoE`:
 *   1. returns a strict `boolean` (total function);
 *   2. is deterministic — two successive calls on the same input return
 *      the same value (pure);
 *   3. agrees with the decision-order oracle specified in design §3:
 *         a. explicit `isMoE` boolean first,
 *         b. else architecture-set lookup (case-insensitive on the
 *            frozen `MOE_ARCHITECTURES` set),
 *         c. else filename regex (`MOE_FILENAME_RE`),
 *         d. else `false` (non-object, missing filename, etc.).
 *
 * Validates: Requirements 3.5
 *
 * Strategy:
 *   - Draw `ModelMeta` values from `arbModelMeta` (the unified helper that
 *     covers all three design shapes: "full GGUF", "filename only",
 *     "MoE override"). This drives every branch of the decision ladder
 *     within the default 100-run fast-check campaign.
 *   - Cross-check each result against an independent oracle re-derived from
 *     the design prose rather than re-exported from the production module.
 *     A shared bug between the implementation and the helper's lists would
 *     otherwise hide behind itself; the oracle re-implements the three
 *     decision steps using only the shape of the spec.
 *   - A dedicated totality case feeds `null`, `undefined`, primitives, and
 *     arrays to the function to confirm the production module's "return
 *     false for non-objects without throwing" contract.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  detectMoE,
  MOE_ARCHITECTURES,
  MOE_FILENAME_RE,
} = require('../../model-classifier.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');

/**
 * Independent oracle for `detectMoE`, derived from design §3. Kept free of
 * production-module imports (apart from the two frozen constants it must
 * agree with — `MOE_ARCHITECTURES` and `MOE_FILENAME_RE`, both of which are
 * part of the public contract) so that a drift between spec and
 * implementation surfaces as a counterexample rather than a silent match.
 *
 * Decision order (first match wins):
 *   1. If `modelMeta` is not an object (including `null`, `undefined`,
 *      primitives, arrays-of-primitives treated as non-records here), the
 *      function returns `false`.
 *   2. If `modelMeta.isMoE` is a strict boolean, return it.
 *   3. If `modelMeta.architecture` is a non-empty string whose lower-case
 *      form is a member of `MOE_ARCHITECTURES`, return `true`.
 *   4. If `modelMeta.filename` is a non-empty string, return
 *      `MOE_FILENAME_RE.test(filename)`.
 *   5. Otherwise return `false`.
 *
 * @param {unknown} modelMeta
 * @returns {boolean}
 */
function oracleDetectMoE(modelMeta) {
  if (modelMeta === null || typeof modelMeta !== 'object') {
    return false;
  }

  // Step 1: explicit boolean override wins outright.
  if (typeof modelMeta.isMoE === 'boolean') {
    return modelMeta.isMoE;
  }

  // Step 2: architecture-set lookup (case-insensitive).
  const arch = modelMeta.architecture;
  if (typeof arch === 'string' && arch.length > 0) {
    if (MOE_ARCHITECTURES.has(arch.toLowerCase())) {
      return true;
    }
  }

  // Step 3: filename regex fallback.
  const filename = modelMeta.filename;
  if (typeof filename === 'string' && filename.length > 0) {
    return MOE_FILENAME_RE.test(filename);
  }

  return false;
}

describe('P41: detectMoE determinism and oracle (Req 3.5)', () => {
  // -----------------------------------------------------------------
  // Totality extension: `detectMoE` must never throw on non-object
  // inputs. This is a task-level requirement ("total function returning
  // `false` for non-objects / `null` / `undefined`") lifted from
  // design §3 / task 4.1. Fast-check's built-in arbitraries don't
  // naturally generate these, so they get a dedicated case.
  // -----------------------------------------------------------------
  it('is a total function over non-object inputs (returns false without throwing)', () => {
    // arbitrary non-object values; excludes plain records
    const arbNonObject = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.string(),
      fc.integer(),
      fc.double({ noNaN: false }),
      fc.boolean(),
      fc.array(fc.anything()),
    );

    fc.assert(
      fc.property(arbNonObject, (value) => {
        const result = detectMoE(value);
        expect(typeof result).to.equal('boolean');
        expect(result).to.equal(false);
      }),
      // Default fast-check runs (100).
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------
  // Core property: every branch of the decision ladder agrees with the
  // independent oracle, and the function is pure (two calls return the
  // same boolean). The result is always a strict boolean.
  // -----------------------------------------------------------------
  it('agrees with the decision-order oracle and is deterministic on ModelMeta', () => {
    fc.assert(
      fc.property(arbModelMeta, (modelMeta) => {
        const first = detectMoE(modelMeta);
        const second = detectMoE(modelMeta);

        // Totality: the return value must be a strict boolean for every
        // legal ModelMeta shape.
        expect(typeof first).to.equal('boolean');

        // Determinism: two successive calls on the same input return the
        // same value. Equivalent to `detectMoE(m) === detectMoE(m)` from
        // the P41 statement in the requirements document.
        expect(first).to.equal(second);

        // Oracle agreement: the production function and the
        // spec-derived oracle agree on every input. Any disagreement is
        // fast-check's shrunk counterexample against design §3.
        expect(first).to.equal(oracleDetectMoE(modelMeta));
      }),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------
  // Per-branch witnesses. fast-check's default weighting already hits
  // each branch, but these targeted properties prevent a silent shift
  // in the weighting from hiding a regression in any individual branch.
  // -----------------------------------------------------------------
  it('honours the explicit isMoE override regardless of other fields', () => {
    // The "MoE override" shape from arb-model-meta sets isMoE: true. We
    // derive the dense-signal counterpart inline so both overrides are
    // covered within a single property.
    const arbWithIsMoE = fc
      .record({
        meta: arbModelMeta,
        override: fc.boolean(),
      })
      .map(({ meta, override }) => {
        // Start from a plain-object copy so we don't mutate fast-check's
        // shrinking cache.
        const cloned = { ...(meta && typeof meta === 'object' ? meta : {}) };
        cloned.isMoE = override;
        return { meta: cloned, override };
      });

    fc.assert(
      fc.property(arbWithIsMoE, ({ meta, override }) => {
        // Step 1 of the oracle: explicit boolean wins.
        expect(detectMoE(meta)).to.equal(override);
      }),
      { numRuns: 100 },
    );
  });
});
