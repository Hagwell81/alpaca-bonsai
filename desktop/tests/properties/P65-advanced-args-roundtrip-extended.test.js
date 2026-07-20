/* eslint-env node, mocha */
/**
 * Property Test P65: Advanced_Args JSON round-trip (extended schema)
 *
 * For any extended `Advanced_Args` object `a` that passes the extended
 * `validateAdvancedArgs`, `parseAdvancedArgs(serializeAdvancedArgs(a))`
 * deep-equals `a` AND still passes `validateAdvancedArgs`.
 *
 * This extends phase-1 Property 32 with the five memory-tuning fields
 * introduced by this spec: `nGpuLayers`, `typeK`, `typeV`, `nCpuMoe`,
 * `threads`.
 *
 * Validates: Requirements 11.3
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const {
  serializeAdvancedArgs,
  parseAdvancedArgs,
  validateAdvancedArgs,
} = require('../../advanced-args');

const {
  arbAdvancedArgsExtended,
} = require('../helpers/arb-memory-advanced-args');

describe('P65: Advanced_Args JSON round-trip (extended schema)', () => {
  it('parseAdvancedArgs(serializeAdvancedArgs(a)) deep-equals a and still validates', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, (a) => {
        // Sanity: every sample from the composed arbitrary must already pass
        // the extended validator; if this fails, the bug is in the helper and
        // not in the round-trip under test.
        const pre = validateAdvancedArgs(a);
        expect(pre.ok, `arbAdvancedArgsExtended produced an invalid sample: ${JSON.stringify(pre)}`).to.equal(true);

        const serialized = serializeAdvancedArgs(a);
        expect(serialized).to.be.a('string');

        const parsed = parseAdvancedArgs(serialized);

        // Round-trip preserves structural equality of the whole object,
        // including the five phase-2 keys.
        expect(parsed).to.deep.equal(a);

        // Round-trip output still satisfies validateAdvancedArgs.
        const post = validateAdvancedArgs(parsed);
        expect(post.ok, `round-tripped object failed validation: ${JSON.stringify(post)}`).to.equal(true);
      }),
      // Default fast-check runs per task instruction (100).
    );
  });

  it('the five memory-tuning keys survive the round-trip verbatim', () => {
    fc.assert(
      fc.property(arbAdvancedArgsExtended, (a) => {
        const parsed = parseAdvancedArgs(serializeAdvancedArgs(a));
        expect(parsed.nGpuLayers).to.equal(a.nGpuLayers);
        expect(parsed.typeK).to.equal(a.typeK);
        expect(parsed.typeV).to.equal(a.typeV);
        expect(parsed.nCpuMoe).to.equal(a.nCpuMoe);
        expect(parsed.threads).to.equal(a.threads);
      }),
    );
  });
});
