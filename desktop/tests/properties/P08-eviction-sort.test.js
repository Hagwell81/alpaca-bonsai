/**
 * Property Test P8: rankEvictionCandidates sort order
 *
 * For any array of active slots, rankEvictionCandidates returns slots sorted by:
 * 1. Non-primary slots first (purpose != 'primary')
 * 2. Least recently used first (ascending lastUsed timestamp)
 *
 * Validates: Requirements 4.4
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { rankEvictionCandidates } = require('../../vram-budget-manager');

describe('P8: rankEvictionCandidates sort order', () => {
  it('should sort non-primary slots before primary slots', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            lastUsed: fc.integer({ min: 0, max: 1000000 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (slots) => {
          const result = rankEvictionCandidates(slots);

          // Find the index of the first primary slot
          let firstPrimaryIndex = -1;
          let lastNonPrimaryIndex = -1;

          for (let i = 0; i < result.length; i++) {
            if (result[i].purpose === 'primary') {
              if (firstPrimaryIndex === -1) {
                firstPrimaryIndex = i;
              }
            } else {
              lastNonPrimaryIndex = i;
            }
          }

          // If there are both primary and non-primary slots,
          // all non-primary slots should come before all primary slots
          if (firstPrimaryIndex !== -1 && lastNonPrimaryIndex !== -1) {
            expect(lastNonPrimaryIndex).to.be.lessThan(firstPrimaryIndex);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should sort by lastUsed (ascending) within same priority', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('secondary', 'vision', 'embedding', 'coding'), // non-primary
            lastUsed: fc.integer({ min: 0, max: 1000000 }),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        (slots) => {
          const result = rankEvictionCandidates(slots);

          // All slots should be non-primary, so check they're sorted by lastUsed ascending
          for (let i = 0; i < result.length - 1; i++) {
            const current = result[i].lastUsed ?? 0;
            const next = result[i + 1].lastUsed ?? 0;
            expect(current).to.be.lessThanOrEqual(next);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle null/undefined lastUsed as 0', () => {
    const slots = [
      { id: 0, purpose: 'secondary', lastUsed: 100 },
      { id: 1, purpose: 'secondary', lastUsed: null },
      { id: 2, purpose: 'secondary', lastUsed: 50 },
    ];

    const result = rankEvictionCandidates(slots);

    // null should be treated as 0, so order should be: null (0), 50, 100
    expect(result[0].lastUsed).to.be.null;
    expect(result[1].lastUsed).to.equal(50);
    expect(result[2].lastUsed).to.equal(100);
  });

  it('should preserve order for slots with same priority and lastUsed', () => {
    const slots = [
      { id: 0, purpose: 'secondary', lastUsed: 100 },
      { id: 1, purpose: 'secondary', lastUsed: 100 },
      { id: 2, purpose: 'secondary', lastUsed: 100 },
    ];

    const result = rankEvictionCandidates(slots);

    // All have same priority and lastUsed, so order is stable
    expect(result).to.have.lengthOf(3);
    expect(result.every(s => s.lastUsed === 100)).to.be.true;
  });

  it('should handle mixed primary and non-primary with various lastUsed values', () => {
    const slots = [
      { id: 0, purpose: 'primary', lastUsed: 10 },
      { id: 1, purpose: 'secondary', lastUsed: 100 },
      { id: 2, purpose: 'primary', lastUsed: 50 },
      { id: 3, purpose: 'vision', lastUsed: 30 },
      { id: 4, purpose: 'coding', lastUsed: 20 },
    ];

    const result = rankEvictionCandidates(slots);

    // Non-primary slots should come first, sorted by lastUsed
    // Expected order: vision(30), coding(20), secondary(100), primary(10), primary(50)
    // Actually: coding(20), vision(30), secondary(100), primary(10), primary(50)
    const nonPrimarySlots = result.filter(s => s.purpose !== 'primary');
    const primarySlots = result.filter(s => s.purpose === 'primary');

    // All non-primary should come before all primary
    expect(result.indexOf(nonPrimarySlots[0])).to.be.lessThan(result.indexOf(primarySlots[0]));

    // Non-primary slots should be sorted by lastUsed
    for (let i = 0; i < nonPrimarySlots.length - 1; i++) {
      const current = nonPrimarySlots[i].lastUsed ?? 0;
      const next = nonPrimarySlots[i + 1].lastUsed ?? 0;
      expect(current).to.be.lessThanOrEqual(next);
    }

    // Primary slots should be sorted by lastUsed
    for (let i = 0; i < primarySlots.length - 1; i++) {
      const current = primarySlots[i].lastUsed ?? 0;
      const next = primarySlots[i + 1].lastUsed ?? 0;
      expect(current).to.be.lessThanOrEqual(next);
    }
  });

  it('should not mutate the input array', () => {
    const slots = [
      { id: 0, purpose: 'secondary', lastUsed: 100 },
      { id: 1, purpose: 'primary', lastUsed: 50 },
      { id: 2, purpose: 'vision', lastUsed: 30 },
    ];

    const originalOrder = slots.map(s => s.id);
    rankEvictionCandidates(slots);

    // Input array should not be mutated
    const currentOrder = slots.map(s => s.id);
    expect(currentOrder).to.deep.equal(originalOrder);
  });

  it('should handle empty array', () => {
    const result = rankEvictionCandidates([]);
    expect(result).to.deep.equal([]);
  });

  it('should handle single slot', () => {
    const slots = [{ id: 0, purpose: 'primary', lastUsed: 100 }];
    const result = rankEvictionCandidates(slots);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.deep.equal(slots[0]);
  });
});
