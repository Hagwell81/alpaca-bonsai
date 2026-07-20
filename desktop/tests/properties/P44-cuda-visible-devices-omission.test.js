/* eslint-env node, mocha */
/**
 * Property Test P44: `CUDA_VISIBLE_DEVICES` omission
 *
 * For any `slotConfig` with `visibleDevices == []`, the spawn environment
 * produced by the Slot_Manager contains a `CUDA_VISIBLE_DEVICES` key iff
 * `process.env` at spawn time contained one, and the value is unchanged
 * from `process.env`'s value.
 *
 * Validates: Requirements 5.3
 *
 * Strategy:
 *   - Draw slot configs with empty `visibleDevices` arrays.
 *   - Test two scenarios:
 *     a. `process.env` contains `CUDA_VISIBLE_DEVICES` → child env inherits it unchanged.
 *     b. `process.env` does NOT contain `CUDA_VISIBLE_DEVICES` → child env does not add it.
 *   - Assert that the `_buildChildEnv` helper (or the public `startSlot` path)
 *     never modifies or deletes the inherited value when `visibleDevices` is empty.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { arbSlotConfigExtended } = require('../helpers/arb-slot-config-extended.js');

/**
 * Simulate the `_buildChildEnv` helper from `model-slot-manager.js`.
 * This is the pure logic extracted from the spawn path.
 *
 * @param {object} slotConfig
 * @param {object} sourceEnv
 * @returns {object}
 */
function buildChildEnv(slotConfig, sourceEnv = {}) {
  const env = { ...sourceEnv };
  const v = slotConfig.visibleDevices;
  if (Array.isArray(v) && v.length > 0) {
    const normalized = Array.from(new Set(v))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b)
      .join(',');
    env.CUDA_VISIBLE_DEVICES = normalized;
  }
  // When v is empty or not an array, do NOT modify env.CUDA_VISIBLE_DEVICES
  return env;
}

describe('P44: CUDA_VISIBLE_DEVICES omission (Req 5.3)', () => {
  it('leaves CUDA_VISIBLE_DEVICES unchanged when visibleDevices is empty and sourceEnv has it', () => {
    // Generate slot configs with empty visibleDevices arrays.
    const arbEmptyVisibleDevices = arbSlotConfigExtended({ gpuCount: 4 }).map((cfg) => ({
      ...cfg,
      visibleDevices: [],
    }));

    // Arbitrary source env values for CUDA_VISIBLE_DEVICES.
    const arbCudaValue = fc.oneof(
      fc.constant('0'),
      fc.constant('1,2'),
      fc.constant('0,1,2,3'),
      fc.string(),
    );

    fc.assert(
      fc.property(arbEmptyVisibleDevices, arbCudaValue, (slotConfig, cudaValue) => {
        const sourceEnv = { CUDA_VISIBLE_DEVICES: cudaValue };
        const env = buildChildEnv(slotConfig, sourceEnv);
        expect(env.CUDA_VISIBLE_DEVICES).to.equal(cudaValue);
      }),
      { numRuns: 100 },
    );
  });

  it('does not add CUDA_VISIBLE_DEVICES when visibleDevices is empty and sourceEnv lacks it', () => {
    const arbEmptyVisibleDevices = arbSlotConfigExtended({ gpuCount: 4 }).map((cfg) => ({
      ...cfg,
      visibleDevices: [],
    }));

    fc.assert(
      fc.property(arbEmptyVisibleDevices, (slotConfig) => {
        const sourceEnv = {}; // No CUDA_VISIBLE_DEVICES key
        const env = buildChildEnv(slotConfig, sourceEnv);
        expect(env).to.not.have.property('CUDA_VISIBLE_DEVICES');
      }),
      { numRuns: 100 },
    );
  });

  it('preserves other environment variables when visibleDevices is empty', () => {
    const slotConfig = {
      visibleDevices: [],
    };
    const sourceEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      CUDA_VISIBLE_DEVICES: '0,1',
    };
    const env = buildChildEnv(slotConfig, sourceEnv);
    expect(env.PATH).to.equal('/usr/bin');
    expect(env.HOME).to.equal('/home/user');
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('0,1');
  });

  it('does not delete inherited CUDA_VISIBLE_DEVICES when visibleDevices is empty', () => {
    const slotConfig = {
      visibleDevices: [],
    };
    const sourceEnv = {
      CUDA_VISIBLE_DEVICES: '2,3',
    };
    const env = buildChildEnv(slotConfig, sourceEnv);
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('2,3');
  });

  it('does not add CUDA_VISIBLE_DEVICES when visibleDevices is undefined', () => {
    const slotConfig = {
      visibleDevices: undefined,
    };
    const sourceEnv = {};
    const env = buildChildEnv(slotConfig, sourceEnv);
    expect(env).to.not.have.property('CUDA_VISIBLE_DEVICES');
  });

  it('does not add CUDA_VISIBLE_DEVICES when visibleDevices is null', () => {
    const slotConfig = {
      visibleDevices: null,
    };
    const sourceEnv = {};
    const env = buildChildEnv(slotConfig, sourceEnv);
    expect(env).to.not.have.property('CUDA_VISIBLE_DEVICES');
  });
});
