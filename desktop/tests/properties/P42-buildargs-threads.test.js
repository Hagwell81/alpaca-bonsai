/* eslint-env node, mocha */
/**
 * Property Test P42: buildArgs `-t` contribution
 *
 * For any `SlotConfig` whose Advanced_Args passes `validateAdvancedArgs`,
 * the argv returned by `buildArgs(slotConfig)`:
 *   - contains the token `-t` exactly once, and
 *   - the token immediately following `-t` equals `String(threads)`.
 *
 * (Design §8, Property 42; design §2 flag contribution row 5 — `-t` is
 * always emitted, inserted after the `mlock` block.)
 *
 * The companion inline restatement in design §8 ("P42: `-t` contribution")
 * adds that the `-t` token is adjacent to its value, i.e. no other flag
 * intervenes. This is implied by "immediately following" but spelled out
 * here so the assertions mirror the design document.
 *
 * Validates: Requirements 4.3
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { buildArgs } = require('../../slot-args-builder');
const {
  arbSlotConfigExtended,
} = require('../helpers/arb-slot-config-extended');

/**
 * Count occurrences of a token in argv.
 *
 * @param {string[]} argv
 * @param {string} token
 * @returns {number}
 */
function countToken(argv, token) {
  let n = 0;
  for (const t of argv) {
    if (t === token) n += 1;
  }
  return n;
}

describe('P42: buildArgs `-t` contribution', () => {
  it('emits `-t` exactly once, immediately followed by String(threads), for any valid SlotConfig', () => {
    fc.assert(
      fc.property(arbSlotConfigExtended(), (slotConfig) => {
        const argv = buildArgs(slotConfig);

        // (1) `-t` appears exactly once.
        const tCount = countToken(argv, '-t');
        expect(tCount, `-t token count for ${JSON.stringify(slotConfig.advancedArgs.threads)}`)
          .to.equal(1);

        // (2) The token immediately following `-t` is `String(threads)`.
        //     `indexOf` is safe because we just asserted exactly one `-t`.
        const tIdx = argv.indexOf('-t');
        expect(tIdx, '`-t` token position').to.be.at.least(0);
        expect(tIdx, '`-t` token is not the final argv element').to.be.below(argv.length - 1);
        expect(argv[tIdx + 1], 'argv[tIdx + 1] equals String(threads)')
          .to.equal(String(slotConfig.advancedArgs.threads));
      }),
      { numRuns: 100 },
    );
  });
});
