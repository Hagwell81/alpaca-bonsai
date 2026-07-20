/**
 * Unit Tests for _buildChildEnv (model-slot-manager.js)
 *
 * Exercises the CUDA_VISIBLE_DEVICES environment injection specified in Req 5.2, 5.3:
 *   - Non-empty visibleDevices array sets CUDA_VISIBLE_DEVICES to dedup-sort-join format
 *   - Empty array leaves inherited CUDA_VISIBLE_DEVICES untouched (both when present and absent)
 *   - The function is pure (does not mutate sourceEnv)
 *
 * Requirements: 5.2, 5.3
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { _buildChildEnv } = require('../../model-slot-manager.js');

describe('_buildChildEnv (Req 5.2, 5.3)', () => {
  describe('Non-empty visibleDevices array', () => {
    it('sets CUDA_VISIBLE_DEVICES to sorted, deduped, comma-joined string', () => {
      const slotConfig = {
        visibleDevices: [1, 0, 2],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,1,2');
    });

    it('deduplicates repeated GPU indices', () => {
      const slotConfig = {
        visibleDevices: [1, 1, 0, 2, 0, 1],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,1,2');
    });

    it('filters out negative integers', () => {
      const slotConfig = {
        visibleDevices: [1, -1, 0, -5, 2],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,1,2');
    });

    it('filters out non-integer values', () => {
      const slotConfig = {
        visibleDevices: [1, 0.5, 2, 'foo', null, undefined, NaN],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('1,2');
    });

    it('handles single GPU index', () => {
      const slotConfig = {
        visibleDevices: [3],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('3');
    });

    it('overwrites existing CUDA_VISIBLE_DEVICES in sourceEnv', () => {
      const slotConfig = {
        visibleDevices: [1, 0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { CUDA_VISIBLE_DEVICES: '2,3,4' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,1');
    });

    it('preserves other environment variables from sourceEnv', () => {
      const slotConfig = {
        visibleDevices: [0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        NODE_ENV: 'test',
      };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.PATH).to.equal('/usr/bin');
      expect(result.HOME).to.equal('/home/user');
      expect(result.NODE_ENV).to.equal('test');
      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0');
    });
  });

  describe('Empty visibleDevices array', () => {
    it('leaves inherited CUDA_VISIBLE_DEVICES untouched when present in sourceEnv', () => {
      const slotConfig = {
        visibleDevices: [],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { CUDA_VISIBLE_DEVICES: '1,2,3' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('1,2,3');
    });

    it('does not add CUDA_VISIBLE_DEVICES when absent in sourceEnv', () => {
      const slotConfig = {
        visibleDevices: [],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result).to.not.have.property('CUDA_VISIBLE_DEVICES');
    });

    it('preserves all other environment variables', () => {
      const slotConfig = {
        visibleDevices: [],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        CUDA_VISIBLE_DEVICES: '0',
      };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.PATH).to.equal('/usr/bin');
      expect(result.HOME).to.equal('/home/user');
      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0');
    });
  });

  describe('Missing or invalid visibleDevices', () => {
    it('does not set CUDA_VISIBLE_DEVICES when visibleDevices is undefined', () => {
      const slotConfig = {
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
        // visibleDevices is undefined
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result).to.not.have.property('CUDA_VISIBLE_DEVICES');
    });

    it('does not set CUDA_VISIBLE_DEVICES when visibleDevices is null', () => {
      const slotConfig = {
        visibleDevices: null,
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result).to.not.have.property('CUDA_VISIBLE_DEVICES');
    });

    it('does not set CUDA_VISIBLE_DEVICES when visibleDevices is not an array', () => {
      const slotConfig = {
        visibleDevices: 'not-an-array',
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result).to.not.have.property('CUDA_VISIBLE_DEVICES');
    });

    it('sets CUDA_VISIBLE_DEVICES to empty string when all values are filtered out', () => {
      const slotConfig = {
        visibleDevices: [-1, -2, 'foo', null, undefined],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      // When all values are filtered out, the array is non-empty but produces an empty string
      // after filtering. The function still sets CUDA_VISIBLE_DEVICES to empty string.
      expect(result.CUDA_VISIBLE_DEVICES).to.equal('');
    });
  });

  describe('Purity (does not mutate sourceEnv)', () => {
    it('does not mutate sourceEnv when setting CUDA_VISIBLE_DEVICES', () => {
      const slotConfig = {
        visibleDevices: [1, 0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin', HOME: '/home/user' };
      const originalEnv = { ...sourceEnv };

      _buildChildEnv(slotConfig, sourceEnv);

      expect(sourceEnv).to.deep.equal(originalEnv);
      expect(sourceEnv).to.not.have.property('CUDA_VISIBLE_DEVICES');
    });

    it('does not mutate sourceEnv when leaving CUDA_VISIBLE_DEVICES untouched', () => {
      const slotConfig = {
        visibleDevices: [],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin', CUDA_VISIBLE_DEVICES: '0,1' };
      const originalEnv = { ...sourceEnv };

      _buildChildEnv(slotConfig, sourceEnv);

      expect(sourceEnv).to.deep.equal(originalEnv);
    });

    it('returns a new object, not sourceEnv', () => {
      const slotConfig = {
        visibleDevices: [0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = { PATH: '/usr/bin' };

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result).to.not.equal(sourceEnv);
    });
  });

  describe('Edge cases', () => {
    it('handles large GPU indices', () => {
      const slotConfig = {
        visibleDevices: [7, 15, 0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,7,15');
    });

    it('handles zero as a valid GPU index', () => {
      const slotConfig = {
        visibleDevices: [0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0');
    });

    it('handles array with only zero', () => {
      const slotConfig = {
        visibleDevices: [0, 0, 0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };
      const sourceEnv = {};

      const result = _buildChildEnv(slotConfig, sourceEnv);

      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0');
    });

    it('uses process.env as default sourceEnv when not provided', () => {
      const slotConfig = {
        visibleDevices: [1, 0],
        modelPath: '/path/to/model.gguf',
        purpose: 'primary',
        advancedArgs: {},
      };

      // Call without sourceEnv parameter
      const result = _buildChildEnv(slotConfig);

      // Should have CUDA_VISIBLE_DEVICES set
      expect(result.CUDA_VISIBLE_DEVICES).to.equal('0,1');
      // Should also have inherited some env vars from process.env
      expect(result).to.be.an('object');
    });
  });
});
