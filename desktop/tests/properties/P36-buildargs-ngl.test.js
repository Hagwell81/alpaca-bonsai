/* eslint-env node, mocha */
/**
 * Property Test P36: `buildArgs` `-ngl` contribution
 *
 * For any `SlotConfig` whose Advanced_Args passes `validateAdvancedArgs`, the
 * argv returned by `buildArgs(slotConfig)`:
 *   - contains the token `-ngl` exactly once iff `nGpuLayers >= 0`;
 *   - when `-ngl` is present, the token immediately following it equals
 *     `String(nGpuLayers)`;
 *   - never contains the tokens `--n-gpu-layers` or `--gpu-layers`
 *     (regardless of `nGpuLayers`);
 *   - contains `-ngl` at most once on every call (determinism + idempotence).
 *
 * Validates: Requirements 1.2, 1.3, 1.4
 *
 * Strategy:
 *   Draw `SlotConfig` values from `arbSlotConfigExtended` (which already
 *   satisfies `validateAdvancedArgs`) and then override `advancedArgs.nGpuLayers`
 *   with a dedicated arbitrary so every branch of the emission rule is
 *   hit within the default 100-run campaign: the sentinel `-1`, `0`, and
 *   the full legal positive range `[1, 999]`.
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
 * Arbitrary for `nGpuLayers` that covers every emission branch:
 *   - `-1` (sentinel, no flag)                    weight 3
 *   - `0`  (flag emitted with value "0")          weight 3
 *   - `[1, 999]` (flag emitted with value String) weight 4
 */
const arbNGpuLayers = fc.oneof(
  { weight: 3, arbitrary: fc.constant(-1) },
  { weight: 3, arbitrary: fc.constant(0) },
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 999 }) },
);

/**
 * Arbitrary yielding a `SlotConfig` whose `advancedArgs.nGpuLayers` is
 * drawn from `arbNGpuLayers` (rather than the extended arb's wider draw).
 */
const arbSlotConfigWithNgl = arbSlotConfigExtended().chain((base) =>
  arbNGpuLayers.map((nGpuLayers) => ({
    ...base,
    advancedArgs: { ...base.advancedArgs, nGpuLayers },
  })),
);

describe('P36: buildArgs -ngl contribution', () => {
  // -------------------------------------------------------------------------
  // Example-style sanity checks. These pin the three branches of the rule
  // so a regression surfaces as a targeted failure rather than as a
  // fast-check counterexample.
  // -------------------------------------------------------------------------

  describe('example: sentinel and boundaries', () => {
    /** Minimal valid SlotConfig builder, matching the phase-1 convention. */
    function makeSlotConfig(nGpuLayers) {
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
          nGpuLayers,
          typeK: 'f16',
          typeV: 'f16',
          nCpuMoe: 0,
          threads: 4,
        },
      };
    }

    it('omits -ngl when nGpuLayers === -1', () => {
      const argv = buildArgs(makeSlotConfig(-1));
      expect(argv).to.not.include('-ngl');
    });

    it('emits -ngl 0 when nGpuLayers === 0', () => {
      const argv = buildArgs(makeSlotConfig(0));
      const idx = argv.indexOf('-ngl');
      expect(idx).to.be.greaterThan(-1);
      expect(argv[idx + 1]).to.equal('0');
      expect(countOccurrences(argv, '-ngl')).to.equal(1);
    });

    it('emits -ngl 999 when nGpuLayers === 999', () => {
      const argv = buildArgs(makeSlotConfig(999));
      const idx = argv.indexOf('-ngl');
      expect(idx).to.be.greaterThan(-1);
      expect(argv[idx + 1]).to.equal('999');
    });

    it('never emits --n-gpu-layers or --gpu-layers', () => {
      for (const n of [-1, 0, 1, 32, 999]) {
        const argv = buildArgs(makeSlotConfig(n));
        expect(argv, `nGpuLayers=${n}`).to.not.include('--n-gpu-layers');
        expect(argv, `nGpuLayers=${n}`).to.not.include('--gpu-layers');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Property-based checks
  // -------------------------------------------------------------------------

  it('emits -ngl exactly once iff nGpuLayers >= 0, with the correct value', () => {
    fc.assert(
      fc.property(arbSlotConfigWithNgl, (slotConfig) => {
        // Precondition: the generated advancedArgs must pass the validator.
        // The extended arb already enforces this by construction; we
        // re-check here so a future generator drift surfaces loudly.
        const v = validateAdvancedArgs(slotConfig.advancedArgs);
        expect(v.ok, `generator produced invalid args: ${JSON.stringify(v)}`).to.equal(true);

        const argv = buildArgs(slotConfig);
        const count = countOccurrences(argv, '-ngl');
        const n = slotConfig.advancedArgs.nGpuLayers;

        if (n >= 0) {
          expect(count).to.equal(1);
          const idx = argv.indexOf('-ngl');
          expect(argv[idx + 1]).to.equal(String(n));
        } else {
          // Sentinel `-1`: the flag must not appear at all.
          expect(count).to.equal(0);
        }
      }),
      // Default fast-check runs (100) per the task description.
      { numRuns: 100 },
    );
  });

  it('never emits --n-gpu-layers or --gpu-layers', () => {
    fc.assert(
      fc.property(arbSlotConfigWithNgl, (slotConfig) => {
        const argv = buildArgs(slotConfig);
        expect(argv).to.not.include('--n-gpu-layers');
        expect(argv).to.not.include('--gpu-layers');
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic and idempotent in the -ngl token (<=1 occurrence)', () => {
    fc.assert(
      fc.property(arbSlotConfigWithNgl, (slotConfig) => {
        const a = buildArgs(slotConfig);
        const b = buildArgs(slotConfig);
        // Determinism: same input ⇒ same output.
        expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
        // Idempotence: `-ngl` appears at most once per call.
        expect(countOccurrences(a, '-ngl')).to.be.at.most(1);
      }),
      { numRuns: 100 },
    );
  });
});
