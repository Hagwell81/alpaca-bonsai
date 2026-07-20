/**
 * Property Test P4: selectSlot result membership
 *
 * For any input tuple, the result of selectSlot is either null (exactly when no slot is running)
 * or an element of the input slots array whose status is 'running'.
 *
 * Validates: Requirements 3.6, 3.7
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { selectSlot } = require('../../slot-selector');

describe('P4: selectSlot result membership', () => {
  it('should return null when no slots are running', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);
          expect(result).to.be.null;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should return a running slot when at least one is running', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);
          const hasRunningSlot = slots.some(s => s.status === 'running');

          if (hasRunningSlot) {
            // Result should not be null
            expect(result).to.not.be.null;
            // Result should have status 'running'
            expect(result.status).to.equal('running');
          } else {
            // Result should be null
            expect(result).to.be.null;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should return an element from the input slots array', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);

          if (result !== null) {
            // Result should be an element of slots
            const isInSlots = slots.some(s => s === result);
            expect(isInSlots).to.be.true;
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should return a slot with status running', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);

          if (result !== null) {
            expect(result.status).to.equal('running');
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should never return a slot with non-running status', () => {
    const nonRunningStatuses = ['idle', 'starting', 'stopping', 'error'];

    nonRunningStatuses.forEach(status => {
      const slots = [
        { id: 0, purpose: 'primary', status, modelPath: 'model-a' },
        { id: 1, purpose: 'secondary', status: 'idle', modelPath: null }
      ];

      const result = selectSlot('message', [], 'model', slots);
      expect(result).to.be.null;
    });
  });

  it('should return a slot that exists in the original array', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 1, purpose: 'secondary', status: 'running', modelPath: 'model-b' },
      { id: 2, purpose: 'vision', status: 'idle', modelPath: null }
    ];

    const result = selectSlot('message', [], 'model-c', slots);

    // Result should be one of the slots
    expect(slots).to.include(result);
  });

  it('should maintain slot object identity', () => {
    const slot0 = { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' };
    const slot1 = { id: 1, purpose: 'secondary', status: 'idle', modelPath: null };
    const slots = [slot0, slot1];

    const result = selectSlot('message', [], 'model', slots);

    // Result should be the exact same object reference
    expect(result).to.equal(slot0);
  });

  it('should handle single running slot', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 1, purpose: 'secondary', status: 'idle', modelPath: null },
      { id: 2, purpose: 'vision', status: 'error', modelPath: null },
      { id: 3, purpose: 'embedding', status: 'stopping', modelPath: null },
      { id: 4, purpose: 'coding', status: 'starting', modelPath: null }
    ];

    const result = selectSlot('any message', [], 'any-model', slots);

    expect(result).to.not.be.null;
    expect(result.id).to.equal(0);
    expect(result.status).to.equal('running');
  });

  it('should handle multiple running slots', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 1, purpose: 'secondary', status: 'running', modelPath: 'model-b' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' },
      { id: 3, purpose: 'embedding', status: 'idle', modelPath: null },
      { id: 4, purpose: 'coding', status: 'idle', modelPath: null }
    ];

    const result = selectSlot('message', [], 'model-x', slots);

    expect(result).to.not.be.null;
    expect(result.status).to.equal('running');
    expect([0, 1, 2]).to.include(result.id);
  });

  it('should return null for empty slots array', () => {
    const result = selectSlot('message', [], 'model', []);
    expect(result).to.be.null;
  });

  it('should handle slots with all non-running statuses', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'idle', modelPath: null },
      { id: 1, purpose: 'secondary', status: 'starting', modelPath: null },
      { id: 2, purpose: 'vision', status: 'stopping', modelPath: null },
      { id: 3, purpose: 'embedding', status: 'error', modelPath: null },
      { id: 4, purpose: 'coding', status: 'idle', modelPath: null }
    ];

    const result = selectSlot('message', [], 'model', slots);
    expect(result).to.be.null;
  });

  it('should satisfy the membership invariant: result is null XOR result is in slots', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);

          // Invariant: result is null XOR result is in slots
          const isNull = result === null;
          const isInSlots = !isNull && slots.some(s => s === result);

          // Exactly one of these should be true
          expect(isNull || isInSlots).to.be.true;
          expect(!(isNull && isInSlots)).to.be.true;
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should satisfy the running status invariant: result is null XOR result.status === running', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(fc.record({ type: fc.constantFrom('image_url', 'text') }), { maxLength: 5 }),
        fc.string({ maxLength: 100 }),
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 4 }),
            purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
            status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          const result = selectSlot(message, attachments, requestedModel, slots);

          // Invariant: result is null XOR result.status === 'running'
          const isNull = result === null;
          const isRunning = !isNull && result.status === 'running';

          // Exactly one of these should be true
          expect(isNull || isRunning).to.be.true;
          expect(!(isNull && isRunning)).to.be.true;
        }
      ),
      { numRuns: 1000 }
    );
  });
});
