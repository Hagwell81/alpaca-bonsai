/* eslint-env node */
/**
 * Property Test P4: Eviction Safety
 * Property Test P5: Eviction Candidate Ranking
 *
 * Validates: Requirements 1.5, 4.1, 4.2, 4.3, 4.4
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const fc = require('fast-check');
const { rankEvictionCandidates } = require('../../eviction-ranker');

describe('P4: Eviction Safety', () => {
  it('no runner with refCount > 0 appears in output', () => {
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
});

describe('P5: Eviction Candidate Ranking', () => {
  it('primary runners never precede non-primary runners', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelPath: fc.string(),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            refCount: fc.constant(0),
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

  it('ascending lastUsedAt within each purpose tier', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelPath: fc.string(),
            purpose: fc.constantFrom('secondary', 'vision', 'coding'),
            refCount: fc.constant(0),
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
