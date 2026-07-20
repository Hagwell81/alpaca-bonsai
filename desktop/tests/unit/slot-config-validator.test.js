/**
 * Unit tests for validateSlotConfig (model-slot-manager.js).
 *
 * Covers the visibleDevices validation logic added in phase-2 (Req 5.4):
 *
 *   - Valid empty array
 *   - Valid in-range array
 *   - Invalid: negative values
 *   - Invalid: non-integer values
 *   - Invalid: values >= gpuCount (when budget.detected === true)
 *   - Invalid: non-array type
 *   - budget.detected === false skips upper-bound check
 *
 * Each reject case asserts both the returned `field` string and a non-empty
 * `reason` string.
 *
 * Requirements: 5.4
 */

const { expect } = require('chai');
const {
  validateSlotConfig,
} = require('../../model-slot-manager.js');

/**
 * Build a minimal valid SlotConfig with the given overrides.
 * The baseline passes validateSlotConfig, so any single-field override
 * makes the validator's decision hinge on that field alone.
 *
 * @param {Partial<SlotConfig>} overrides
 */
function slotConfigWith(overrides) {
  return {
    modelPath: '/path/to/model.gguf',
    purpose: 'primary',
    port: 13434,
    advancedArgs: {},
    visibleDevices: [],
    ...overrides,
  };
}

/**
 * Build a minimal budget object with the given overrides.
 *
 * @param {Partial<Budget>} overrides
 */
function budgetWith(overrides) {
  return {
    detected: true,
    totalVramMB: 8192,
    reservedMB: 512,
    gpuCount: 2,
    physicalCores: 8,
    ...overrides,
  };
}

/**
 * Assert a `{ ok: false, field, reason }` shape with the expected field and a
 * non-empty string reason.
 *
 * @param {ReturnType<typeof validateSlotConfig>} result
 * @param {string} expectedField
 */
function expectReject(result, expectedField) {
  expect(result).to.be.an('object');
  expect(result.ok).to.equal(false);
  expect(result.field).to.equal(expectedField);
  expect(result.reason).to.be.a('string').and.not.equal('');
}

describe('validateSlotConfig - visibleDevices validation', () => {
  // Sanity anchor: the shared baseline must itself be valid
  it('accepts a valid baseline slot config', () => {
    const result = validateSlotConfig(
      slotConfigWith({}),
      budgetWith({})
    );
    expect(result).to.deep.equal({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Valid cases
  // -------------------------------------------------------------------------
  describe('Valid visibleDevices', () => {
    it('accepts an empty array', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [] }),
        budgetWith({ gpuCount: 2 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('accepts a valid in-range array', () => {
      // [0, 1] is valid when gpuCount === 2
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 1] }),
        budgetWith({ gpuCount: 2 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('accepts a single-element array', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0] }),
        budgetWith({ gpuCount: 2 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('accepts duplicates (deduplication happens in _buildChildEnv)', () => {
      // The validator does not reject duplicates; _buildChildEnv handles dedup
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 0, 1] }),
        budgetWith({ gpuCount: 2 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('accepts undefined visibleDevices', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: undefined }),
        budgetWith({ gpuCount: 2 })
      );
      expect(result).to.deep.equal({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Invalid cases: type errors
  // -------------------------------------------------------------------------
  describe('Invalid visibleDevices - type errors', () => {
    it('rejects a non-array value with field "visibleDevices"', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: 'not-an-array' }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('must be an array');
    });

    it('rejects an array with non-integer elements', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 1.5] }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });

    it('rejects an array with string elements', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, '1'] }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });

    it('rejects an array with null elements', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, null] }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });
  });

  // -------------------------------------------------------------------------
  // Invalid cases: negative values
  // -------------------------------------------------------------------------
  describe('Invalid visibleDevices - negative values', () => {
    it('rejects an array with negative elements', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, -1] }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });

    it('rejects an array with only negative elements', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [-1] }),
        budgetWith({ gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });
  });

  // -------------------------------------------------------------------------
  // Invalid cases: values >= gpuCount (when budget.detected === true)
  // -------------------------------------------------------------------------
  describe('Invalid visibleDevices - out of range', () => {
    it('rejects values >= gpuCount when budget.detected === true', () => {
      // gpuCount === 2, so valid indices are [0, 1]; 2 is out of range
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 2] }),
        budgetWith({ detected: true, gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('exceeds detected GPU count');
      expect(result.reason).to.include('2');
    });

    it('rejects values far exceeding gpuCount', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 99] }),
        budgetWith({ detected: true, gpuCount: 2 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('exceeds detected GPU count');
    });
  });

  // -------------------------------------------------------------------------
  // budget.detected === false skips upper-bound check
  // -------------------------------------------------------------------------
  describe('budget.detected === false skips upper-bound check', () => {
    it('accepts values >= gpuCount when budget.detected === false', () => {
      // When detection fails, we cannot validate the upper bound
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 5, 10] }),
        budgetWith({ detected: false, gpuCount: 0 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('still rejects negative values when budget.detected === false', () => {
      // Non-negative check is independent of detection
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [-1] }),
        budgetWith({ detected: false, gpuCount: 0 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });

    it('still rejects non-integer values when budget.detected === false', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [1.5] }),
        budgetWith({ detected: false, gpuCount: 0 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('non-negative integer');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('accepts visibleDevices with gpuCount === 1', () => {
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0] }),
        budgetWith({ gpuCount: 1 })
      );
      expect(result).to.deep.equal({ ok: true });
    });

    it('rejects visibleDevices [1] when gpuCount === 1', () => {
      // Only valid index is 0 when gpuCount === 1
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [1] }),
        budgetWith({ detected: true, gpuCount: 1 })
      );
      expectReject(result, 'visibleDevices');
      expect(result.reason).to.include('exceeds detected GPU count');
    });

    it('accepts large valid arrays', () => {
      // 8 GPUs, all indices valid
      const result = validateSlotConfig(
        slotConfigWith({ visibleDevices: [0, 1, 2, 3, 4, 5, 6, 7] }),
        budgetWith({ gpuCount: 8 })
      );
      expect(result).to.deep.equal({ ok: true });
    });
  });
});
