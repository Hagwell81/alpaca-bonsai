/**
 * Property Test P37: buildArgs `--type-k` / `--type-v` contribution
 *
 * For any valid `SlotConfig` drawn from `arbSlotConfigExtended`:
 *
 *   - argv contains the token `--type-k` exactly once iff
 *     `advancedArgs.typeK !== 'f16'`.
 *   - When `--type-k` is present, the immediately following argv entry
 *     equals `String(advancedArgs.typeK)`.
 *   - The symmetric property holds for `--type-v` / `advancedArgs.typeV`.
 *
 * Phase-1 convention: `f16` is the upstream default, so omitting the flag
 * keeps argv minimal (design §2, Req 2.2). The insertion order rule (the
 * flag appears inside the "offload / KV-precision" block between `-np` and
 * the multi-GPU distribution flags) is covered separately by P14's
 * adjacency rules on the existing phase-1 flags; this test focuses on the
 * presence / absence / adjacency invariants for the two new KV-precision
 * flags.
 *
 * Default fast-check run count (100).
 *
 * **Validates: Requirements 2.2**
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');
const { buildArgs } = require('../../slot-args-builder');
const {
  arbSlotConfigExtended,
} = require('../helpers/arb-slot-config-extended');

/**
 * Count how many times `token` appears in `argv`.
 * @param {string[]} argv
 * @param {string} token
 * @returns {number}
 */
function countOccurrences(argv, token) {
  let n = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === token) n += 1;
  }
  return n;
}

describe('P37: buildArgs --type-k / --type-v contribution', () => {
  it('emits --type-k iff typeK !== "f16" with the correct value adjacent', () => {
    fc.assert(
      fc.property(arbSlotConfigExtended(), (slotConfig) => {
        const argv = buildArgs(slotConfig);
        const { typeK } = slotConfig.advancedArgs;
        const count = countOccurrences(argv, '--type-k');

        if (typeK === 'f16') {
          // Default upstream value → flag must be omitted entirely.
          expect(count).to.equal(
            0,
            `--type-k must not appear when typeK === 'f16'`,
          );
        } else {
          // Non-default → flag present exactly once, followed by String(typeK).
          expect(count).to.equal(
            1,
            `--type-k must appear exactly once when typeK !== 'f16' (got ${count})`,
          );
          const idx = argv.indexOf('--type-k');
          expect(idx).to.be.lessThan(
            argv.length - 1,
            '--type-k must be followed by a value (not the last token)',
          );
          expect(argv[idx + 1]).to.equal(String(typeK));
        }
      }),
    );
  });

  it('emits --type-v iff typeV !== "f16" with the correct value adjacent', () => {
    fc.assert(
      fc.property(arbSlotConfigExtended(), (slotConfig) => {
        const argv = buildArgs(slotConfig);
        const { typeV } = slotConfig.advancedArgs;
        const count = countOccurrences(argv, '--type-v');

        if (typeV === 'f16') {
          expect(count).to.equal(
            0,
            `--type-v must not appear when typeV === 'f16'`,
          );
        } else {
          expect(count).to.equal(
            1,
            `--type-v must appear exactly once when typeV !== 'f16' (got ${count})`,
          );
          const idx = argv.indexOf('--type-v');
          expect(idx).to.be.lessThan(
            argv.length - 1,
            '--type-v must be followed by a value (not the last token)',
          );
          expect(argv[idx + 1]).to.equal(String(typeV));
        }
      }),
    );
  });

  it('emits --type-k and --type-v independently per the iff rule', () => {
    // Joint check: neither flag's presence should depend on the other's
    // value. Both are governed solely by their own field vs. the default
    // `'f16'`.
    fc.assert(
      fc.property(arbSlotConfigExtended(), (slotConfig) => {
        const argv = buildArgs(slotConfig);
        const { typeK, typeV } = slotConfig.advancedArgs;

        const typeKPresent = argv.includes('--type-k');
        const typeVPresent = argv.includes('--type-v');

        expect(typeKPresent).to.equal(
          typeK !== 'f16',
          `--type-k presence must match (typeK !== 'f16'); typeK=${typeK}, typeV=${typeV}`,
        );
        expect(typeVPresent).to.equal(
          typeV !== 'f16',
          `--type-v presence must match (typeV !== 'f16'); typeK=${typeK}, typeV=${typeV}`,
        );
      }),
    );
  });
});
