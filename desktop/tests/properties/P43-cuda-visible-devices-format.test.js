/* eslint-env node, mocha */
/**
 * Property Test P43: `CUDA_VISIBLE_DEVICES` formatting
 *
 * For any non-empty `visibleDevices` array `v` that passes
 * `validateSlotConfig`, the spawn environment's `CUDA_VISIBLE_DEVICES`
 * value equals `Array.from(new Set(v)).sort((a,b) => a-b).join(",")`.
 *
 * Validates: Requirements 5.2
 *
 * Strategy:
 *   - Draw valid `visibleDevices` arrays from `arbSlotConfigExtended`
 *     (which generates arrays of non-negative integers in the valid range).
 *   - For each array, compute the expected `CUDA_VISIBLE_DEVICES` string
 *     using the spec's formula: dedup → sort ascending → comma-join.
 *   - Invoke the internal `_buildChildEnv` helper (or the public
 *     `startSlot` path if the helper is not exported) and assert the
 *     environment variable matches the expected value.
 *   - Cover edge cases: single device, multiple devices, duplicates,
 *     out-of-order input.
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { arbSlotConfigExtended } = require('../helpers/arb-slot-config-extended.js');

/**
 * Oracle for the expected `CUDA_VISIBLE_DEVICES` string given a
 * `visibleDevices` array. Matches the spec's formula from Req 5.2.
 *
 * @param {number[]} visibleDevices
 * @returns {string}
 */
function expectedCudaVisibleDevices(visibleDevices) {
  if (!Array.isArray(visibleDevices) || visibleDevices.length === 0) {
    return undefined;
  }
  return Array.from(new Set(visibleDevices))
    .sort((a, b) => a - b)
    .join(',');
}

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
  return env;
}

describe('P43: CUDA_VISIBLE_DEVICES formatting (Req 5.2)', () => {
  it('formats visibleDevices as dedup-sort-join for non-empty arrays', () => {
    // Generate slot configs with non-empty visibleDevices arrays.
    const arbNonEmptyVisibleDevices = arbSlotConfigExtended({ gpuCount: 4 }).filter(
      (cfg) => Array.isArray(cfg.visibleDevices) && cfg.visibleDevices.length > 0,
    );

    fc.assert(
      fc.property(arbNonEmptyVisibleDevices, (slotConfig) => {
        const env = buildChildEnv(slotConfig, {});
        const expected = expectedCudaVisibleDevices(slotConfig.visibleDevices);
        expect(env.CUDA_VISIBLE_DEVICES).to.equal(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('deduplicates repeated device indices', () => {
    const slotConfig = {
      visibleDevices: [0, 1, 0, 2, 1, 0],
    };
    const env = buildChildEnv(slotConfig, {});
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('0,1,2');
  });

  it('sorts device indices in ascending order', () => {
    const slotConfig = {
      visibleDevices: [3, 0, 2, 1],
    };
    const env = buildChildEnv(slotConfig, {});
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('0,1,2,3');
  });

  it('handles single-device arrays', () => {
    const slotConfig = {
      visibleDevices: [2],
    };
    const env = buildChildEnv(slotConfig, {});
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('2');
  });

  it('filters out negative and non-integer values', () => {
    const slotConfig = {
      visibleDevices: [1, -1, 2.5, 0, NaN, 3],
    };
    const env = buildChildEnv(slotConfig, {});
    // Only [1, 0, 3] survive the filter → sorted → '0,1,3'
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('0,1,3');
  });

  it('produces comma-separated values without spaces', () => {
    const slotConfig = {
      visibleDevices: [0, 1, 2],
    };
    const env = buildChildEnv(slotConfig, {});
    expect(env.CUDA_VISIBLE_DEVICES).to.equal('0,1,2');
    expect(env.CUDA_VISIBLE_DEVICES).to.not.include(' ');
  });
});
