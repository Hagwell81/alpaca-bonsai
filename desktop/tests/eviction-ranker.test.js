/* eslint-env node */
const { describe, it } = require('mocha');
const { expect } = require('chai');
const fc = require('fast-check');
const { rankEvictionCandidates } = require('../eviction-ranker');

describe('eviction-ranker', () => {
  describe('rankEvictionCandidates', () => {
    it('should exclude runners with refCount > 0', () => {
      const runners = [
        { modelPath: 'a.gguf', purpose: 'primary', refCount: 1, lastUsedAt: 10 },
        { modelPath: 'b.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 20 },
      ];
      const result = rankEvictionCandidates(runners);
      expect(result).to.have.lengthOf(1);
      expect(result[0].modelPath).to.equal('b.gguf');
    });

    it('should sort non-primary before primary', () => {
      const runners = [
        { modelPath: 'primary.gguf', purpose: 'primary', refCount: 0, lastUsedAt: 10 },
        { modelPath: 'vision.gguf', purpose: 'vision', refCount: 0, lastUsedAt: 100 },
      ];
      const result = rankEvictionCandidates(runners);
      expect(result[0].modelPath).to.equal('vision.gguf');
      expect(result[1].modelPath).to.equal('primary.gguf');
    });

    it('should sort by ascending lastUsedAt within same purpose tier', () => {
      const runners = [
        { modelPath: 'c.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 300 },
        { modelPath: 'a.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 100 },
        { modelPath: 'b.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 200 },
      ];
      const result = rankEvictionCandidates(runners);
      expect(result.map((r) => r.modelPath)).to.deep.equal([
        'a.gguf',
        'b.gguf',
        'c.gguf',
      ]);
    });

    it('should break ties by ascending keepAliveDurationMs', () => {
      const runners = [
        { modelPath: 'long.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 100, keepAliveDurationMs: 600000 },
        { modelPath: 'short.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 100, keepAliveDurationMs: 60000 },
      ];
      const result = rankEvictionCandidates(runners);
      expect(result[0].modelPath).to.equal('short.gguf');
      expect(result[1].modelPath).to.equal('long.gguf');
    });

    it('should not mutate the input array', () => {
      const runners = [
        { modelPath: 'b.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 200 },
        { modelPath: 'a.gguf', purpose: 'primary', refCount: 0, lastUsedAt: 100 },
      ];
      const originalOrder = runners.map((r) => r.modelPath);
      rankEvictionCandidates(runners);
      expect(runners.map((r) => r.modelPath)).to.deep.equal(originalOrder);
    });

    it('should handle empty array', () => {
      const result = rankEvictionCandidates([]);
      expect(result).to.deep.equal([]);
    });

    it('should handle single runner', () => {
      const runners = [
        { modelPath: 'a.gguf', purpose: 'primary', refCount: 0, lastUsedAt: 100 },
      ];
      const result = rankEvictionCandidates(runners);
      expect(result).to.have.lengthOf(1);
    });

    it('should treat missing keepAliveDurationMs as 0', () => {
      const runners = [
        { modelPath: 'missing.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 100 },
        { modelPath: 'present.gguf', purpose: 'secondary', refCount: 0, lastUsedAt: 100, keepAliveDurationMs: 60000 },
      ];
      const result = rankEvictionCandidates(runners);
      // missing (0) should come before present (60000)
      expect(result[0].modelPath).to.equal('missing.gguf');
      expect(result[1].modelPath).to.equal('present.gguf');
    });

    it('property: no runner with refCount > 0 appears in output', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelPath: fc.string(),
              purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
              refCount: fc.integer({ min: 0, max: 10 }),
              lastUsedAt: fc.integer({ min: 0, max: 1000000 }),
              keepAliveDurationMs: fc.integer({ min: 0, max: 600000 }),
            }),
            { minLength: 0, maxLength: 20 }
          ),
          (runners) => {
            const result = rankEvictionCandidates(runners);
            return result.every((r) => (r.refCount || 0) === 0);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('property: primary runners never precede non-primary runners', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelPath: fc.string(),
              purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
              refCount: fc.integer({ min: 0, max: 0 }), // keep refCount at 0
              lastUsedAt: fc.integer({ min: 0, max: 1000000 }),
              keepAliveDurationMs: fc.integer({ min: 0, max: 600000 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (runners) => {
            const result = rankEvictionCandidates(runners);
            let firstPrimaryIndex = -1;
            let lastNonPrimaryIndex = -1;
            for (let i = 0; i < result.length; i++) {
              if (result[i].purpose === 'primary') {
                if (firstPrimaryIndex === -1) firstPrimaryIndex = i;
              } else {
                lastNonPrimaryIndex = i;
              }
            }
            if (firstPrimaryIndex !== -1 && lastNonPrimaryIndex !== -1) {
              return lastNonPrimaryIndex < firstPrimaryIndex;
            }
            return true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('property: ascending lastUsedAt within each purpose tier', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              modelPath: fc.string(),
              purpose: fc.constantFrom('secondary', 'vision', 'coding'),
              refCount: fc.integer({ min: 0, max: 0 }),
              lastUsedAt: fc.integer({ min: 0, max: 1000000 }),
              keepAliveDurationMs: fc.integer({ min: 0, max: 600000 }),
            }),
            { minLength: 2, maxLength: 20 }
          ),
          (runners) => {
            const result = rankEvictionCandidates(runners);
            for (let i = 0; i < result.length - 1; i++) {
              const curr = result[i].lastUsedAt ?? 0;
              const next = result[i + 1].lastUsedAt ?? 0;
              if (curr > next) return false;
            }
            return true;
          }
        ),
        { numRuns: 1000 }
      );
    });
  });
});
