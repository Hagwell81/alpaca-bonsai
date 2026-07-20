/* eslint-env node, mocha */
/**
 * Property Test P40: `buildArgs` `--n-cpu-moe` contribution
 *
 * For any `SlotConfig` whose Advanced_Args passes `validateAdvancedArgs`,
 * the argv returned by `buildArgs(slotConfig)`:
 *   - contains the token `--n-cpu-moe` exactly once iff `nCpuMoe > 0`;
 *   - when `--n-cpu-moe` is present, the token immediately following it
 *     equals `String(nCpuMoe)`;
 *   - contains `--n-cpu-moe` at most once per call (determinism + idempotence).
 *
 * The `nCpuMoe === 0` case is explicitly verified as the flag's absence: `0`
 * means "do not set the flag" (Req 3.3), so no `--n-cpu-moe` token may
 * appear in the argv even though the field is part of every valid
 * Advanced_Args.
 *
 * Validates: Requirements 3.2, 3.3
 *
 * Strategy:
 *   Draw `SlotConfig` values from `arbSlotConfigExtended` (which already
 *   satisfies `validateAdvancedArgs`) and override `advancedArgs.nCpuMoe`
 *   with a dedicated arbitrary so both branches of the emission rule are
 *   exercised within the default 100-run campaign: the boundary value `0`
 *   and the full legal positive range `[1, 999]`.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { buildArgs } = require('../../slot-args-builder');
const { validateAdvancedArgs } = require('../../advanced-args');
const {
  arbSlotConfigExtended,
} = require('../helpers/arb-slot-config-extended');

/**
 * Count the number of occurrences of `token` in `argv`.
 * @param {string[]} argv
 * @param {string}   token
 * @returns {number}
 */
function countOccurrences(argv, token) {
  let n = 0;
  for (const t of argv) {
    if (t === token) {
      n += 1;
    }
  }
  return n;
}

/**
 * Arbitrary for `nCpuMoe` that covers every emission branch:
 *   - `0`           (no flag; Req 3.3)                    weight 3
 *   - `[1, 999]`    (flag emitted with value String)      weight 4
 *
 * Legal range per Req 3.1 and the Task 2.1 generator contract is
 * `[0, 999]` inclusive.
 */
const arbNCpuMoe = fc.oneof(
  { weight: 3, arbitrary: fc.constant(0) },
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 999 }) },
);

/**
 * Arbitrary yielding a `SlotConfig` whose `advancedArgs.nCpuMoe` is
 * drawn from `arbNCpuMoe` (rather than the extended arb's wider draw).
 */
const arbSlotConfigWithNCpuMoe = arbSlotConfigExtended().chain((base) =>
  arbNCpuMoe.map((nCpuMoe) => ({
    ...base,
    advancedArgs: { ...base.advancedArgs, nCpuMoe },
  })),
);

describe('P40: buildArgs --n-cpu-moe contribution', () => {
  // -------------------------------------------------------------------------
  // Example-style sanity checks. These pin the two branches of the rule
  // so a regression surfaces as a targeted failure rather than as a
  // fast-check counterexample.
  // -------------------------------------------------------------------------

  describe('example: boundary values', () => {
    /** Minimal valid SlotConfig builder, matching the phase-1 convention. */
    function makeSlotConfig(nCpuMoe) {
      return {
        modelPath: '/models/m.gguf',
        mmprojPath: null,
        port: 13434,
        purpose: 'primary',
        visibleDevices: [],
        advancedArgs: {
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
          speculative: { enabled: false, draftModel: null, draftCtxSize: 4096 },
          nGpuLayers: -1,
          typeK: 'f16',
          typeV: 'f16',
          nCpuMoe,
          threads: 4,
        },
      };
    }

    it('omits --n-cpu-moe when nCpuMoe === 0', () => {
      const argv = buildArgs(makeSlotConfig(0));
      expect(argv).to.not.include('--n-cpu-moe');
    });

    it('emits --n-cpu-moe 1 when nCpuMoe === 1', () => {
      const argv = buildArgs(makeSlotConfig(1));
      const idx = argv.indexOf('--n-cpu-moe');
      expect(idx).to.be.greaterThan(-1);
      expect(argv[idx + 1]).to.equal('1');
      expect(countOccurrences(argv, '--n-cpu-moe')).to.equal(1);
    });

    it('emits --n-cpu-moe 999 when nCpuMoe === 999', () => {
      const argv = buildArgs(makeSlotConfig(999));
      const idx = argv.indexOf('--n-cpu-moe');
      expect(idx).to.be.greaterThan(-1);
      expect(argv[idx + 1]).to.equal('999');
    });
  });

  // -------------------------------------------------------------------------
  // Property-based checks
  // -------------------------------------------------------------------------

  it('emits --n-cpu-moe exactly once iff nCpuMoe > 0, with the correct value adjacent', () => {
    fc.assert(
      fc.property(arbSlotConfigWithNCpuMoe, (slotConfig) => {
        // Precondition: the generated advancedArgs must pass the validator.
        // The extended arb enforces this by construction; we re-check here
        // so a future generator drift surfaces loudly.
        const v = validateAdvancedArgs(slotConfig.advancedArgs);
        expect(
          v.ok,
          `generator produced invalid args: ${JSON.stringify(v)}`,
        ).to.equal(true);

        const argv = buildArgs(slotConfig);
        const count = countOccurrences(argv, '--n-cpu-moe');
        const n = slotConfig.advancedArgs.nCpuMoe;

        if (n > 0) {
          expect(count).to.equal(1);
          const idx = argv.indexOf('--n-cpu-moe');
          expect(idx).to.be.lessThan(
            argv.length - 1,
            '--n-cpu-moe must be followed by a value (not the last token)',
          );
          expect(argv[idx + 1]).to.equal(String(n));
        } else {
          // nCpuMoe === 0 (Req 3.3): the flag must not appear at all.
          expect(count).to.equal(0);
        }
      }),
      // Default fast-check runs (100) per the task description.
      { numRuns: 100 },
    );
  });

  it('is deterministic and idempotent in the --n-cpu-moe token (<=1 occurrence)', () => {
    fc.assert(
      fc.property(arbSlotConfigWithNCpuMoe, (slotConfig) => {
        const a = buildArgs(slotConfig);
        const b = buildArgs(slotConfig);
        // Determinism: same input ⇒ same output.
        expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
        // Idempotence: `--n-cpu-moe` appears at most once per call.
        expect(countOccurrences(a, '--n-cpu-moe')).to.be.at.most(1);
      }),
      { numRuns: 100 },
    );
  });
});
