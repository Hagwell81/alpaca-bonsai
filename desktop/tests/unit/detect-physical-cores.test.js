/**
 * Unit tests for detectPhysicalCores (advanced-args.js)
 *
 * Verifies the pure wrapper around `os.cpus()`:
 *   - Dedupes logical CPUs by the `model + speed` signature
 *   - Clamps the resulting count to the [1, 256] range
 *   - Falls back to `4` on empty arrays and on `os.cpus()` throwing
 *   - Emits no warnings (function is silent by contract)
 *
 * Requirements: 4.2
 */

const { expect } = require('chai');
const { detectPhysicalCores } = require('../../advanced-args');

/**
 * Build a minimal mock `os`-like module whose `cpus()` returns the given array.
 * @param {Array<{model: string, speed: number}>} cpus
 */
function osWithCpus(cpus) {
  return { cpus: () => cpus };
}

/**
 * Build a minimal mock `os`-like module whose `cpus()` throws.
 * @param {Error} err
 */
function osThatThrows(err) {
  return {
    cpus: () => {
      throw err;
    },
  };
}

describe('detectPhysicalCores', () => {
  describe('dedupe by model + speed signature', () => {
    it('collapses identical hyper-threaded logical CPUs to a single physical core', () => {
      // 8 logical CPUs all reporting the same model+speed: one physical signature
      const cpus = Array.from({ length: 8 }, () => ({
        model: 'Intel(R) Core(TM) i7-1165G7 @ 2.80GHz',
        speed: 2800,
      }));

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(1);
    });

    it('returns the number of distinct signatures when cores differ', () => {
      // 4 logical CPUs with two distinct signatures -> 2 physical "cores"
      const cpus = [
        { model: 'P-Core', speed: 4000 },
        { model: 'P-Core', speed: 4000 },
        { model: 'E-Core', speed: 2400 },
        { model: 'E-Core', speed: 2400 },
      ];

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(2);
    });

    it('distinguishes same model but different speeds', () => {
      const cpus = [
        { model: 'Same Model', speed: 3000 },
        { model: 'Same Model', speed: 3200 },
        { model: 'Same Model', speed: 3400 },
      ];

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(3);
    });

    it('distinguishes different models at the same speed', () => {
      const cpus = [
        { model: 'Model A', speed: 3000 },
        { model: 'Model B', speed: 3000 },
      ];

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(2);
    });
  });

  describe('clamp to [1, 256]', () => {
    it('clamps counts above 256 down to 256', () => {
      // 300 distinct signatures -> clamped to 256
      const cpus = Array.from({ length: 300 }, (_, i) => ({
        model: `Core-${i}`,
        speed: 1000 + i,
      }));

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(256);
    });

    it('returns exactly 256 at the upper boundary', () => {
      const cpus = Array.from({ length: 256 }, (_, i) => ({
        model: `Core-${i}`,
        speed: 1000 + i,
      }));

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(256);
    });

    it('returns 1 when exactly one distinct signature is present', () => {
      const cpus = [{ model: 'Single', speed: 2000 }];

      expect(detectPhysicalCores(osWithCpus(cpus))).to.equal(1);
    });
  });

  describe('fallback to 4', () => {
    it('returns 4 when os.cpus() returns an empty array', () => {
      expect(detectPhysicalCores(osWithCpus([]))).to.equal(4);
    });

    it('returns 4 when os.cpus() throws', () => {
      expect(detectPhysicalCores(osThatThrows(new Error('boom')))).to.equal(4);
    });

    it('returns 4 when os.cpus() returns a non-array value', () => {
      // Defensive: if an exotic os impl returned null/undefined/non-array
      expect(detectPhysicalCores({ cpus: () => null })).to.equal(4);
      expect(detectPhysicalCores({ cpus: () => undefined })).to.equal(4);
      expect(detectPhysicalCores({ cpus: () => 'not-an-array' })).to.equal(4);
    });
  });

  describe('return-type contract', () => {
    it('always returns an integer in [1, 256]', () => {
      const samples = [
        osWithCpus([]),
        osWithCpus([{ model: 'A', speed: 1 }]),
        osWithCpus(Array.from({ length: 4 }, () => ({ model: 'A', speed: 1 }))),
        osWithCpus(Array.from({ length: 300 }, (_, i) => ({ model: `m${i}`, speed: i }))),
        osThatThrows(new Error('nope')),
      ];

      for (const os of samples) {
        const n = detectPhysicalCores(os);
        expect(Number.isInteger(n), `expected integer, got ${n}`).to.be.true;
        expect(n).to.be.at.least(1);
        expect(n).to.be.at.most(256);
      }
    });

    it('uses the built-in `os` module when no argument is supplied', () => {
      // Does not throw and returns a legal integer; the actual value depends
      // on the host but must respect the documented [1, 256] contract.
      const n = detectPhysicalCores();
      expect(Number.isInteger(n)).to.be.true;
      expect(n).to.be.at.least(1);
      expect(n).to.be.at.most(256);
    });
  });
});
