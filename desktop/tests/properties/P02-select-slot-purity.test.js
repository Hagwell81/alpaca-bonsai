/**
 * Property Test P2: selectSlot determinism and purity
 *
 * For any (message, attachments, requestedModel, slots) tuple (with slots deep-frozen),
 * selectSlot returns the same result on two successive calls and performs no mutation
 * of slots or its contents.
 *
 * Validates: Requirements 3.8
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { selectSlot } = require('../../slot-selector');

/**
 * Deep freeze an object to detect any mutation attempts
 */
function deepFreeze(obj) {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    if (obj[prop] !== null && (typeof obj[prop] === 'object' || typeof obj[prop] === 'function')) {
      deepFreeze(obj[prop]);
    }
  });
  return obj;
}

describe('P2: selectSlot determinism and purity', () => {
  it('should be deterministic: same inputs produce same output', () => {
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
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          // Deep freeze the slots to detect mutations
          const frozenSlots = deepFreeze(JSON.parse(JSON.stringify(slots)));

          // Call selectSlot twice with the same inputs
          const result1 = selectSlot(message, attachments, requestedModel, frozenSlots);
          const result2 = selectSlot(message, attachments, requestedModel, frozenSlots);

          // Results should be identical
          if (result1 === null) {
            expect(result2).to.be.null;
          } else {
            expect(result2).to.not.be.null;
            expect(result2.id).to.equal(result1.id);
            expect(result2.purpose).to.equal(result1.purpose);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should not mutate the slots array', () => {
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
            modelPath: fc.option(fc.string({ maxLength: 100 }), { freq: 3 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (message, attachments, requestedModel, slots) => {
          // Create a deep copy to compare before and after
          const slotsCopy = JSON.parse(JSON.stringify(slots));

          // Call selectSlot
          selectSlot(message, attachments, requestedModel, slots);

          // Slots should not be mutated
          expect(JSON.stringify(slots)).to.equal(JSON.stringify(slotsCopy));
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should not mutate individual slot objects', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: '/path/to/model' },
      { id: 1, purpose: 'secondary', status: 'idle', modelPath: null },
    ];

    const originalSlots = JSON.parse(JSON.stringify(slots));

    selectSlot('test message', [], 'model', slots);

    // Verify no mutations
    expect(JSON.stringify(slots)).to.equal(JSON.stringify(originalSlots));
  });

  it('should not mutate attachments array', () => {
    const slots = [{ id: 0, purpose: 'primary', status: 'running', modelPath: 'model' }];
    const attachments = [{ type: 'image_url', url: 'http://example.com/image.jpg' }];
    const originalAttachments = JSON.parse(JSON.stringify(attachments));

    selectSlot('test message', attachments, 'model', slots);

    expect(JSON.stringify(attachments)).to.equal(JSON.stringify(originalAttachments));
  });

  it('should handle deep-frozen slots without throwing', () => {
    const slots = deepFreeze([
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model' },
      { id: 1, purpose: 'secondary', status: 'idle', modelPath: null },
    ]);

    // Should not throw when calling selectSlot with frozen slots
    expect(() => {
      selectSlot('test message', [], 'model', slots);
    }).to.not.throw();
  });

  it('should return the same slot object reference on deterministic calls', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model' },
      { id: 1, purpose: 'secondary', status: 'idle', modelPath: null },
    ];

    const result1 = selectSlot('test message', [], 'model', slots);
    const result2 = selectSlot('test message', [], 'model', slots);

    // Should return the exact same object reference
    expect(result1).to.equal(result2);
  });

  it('should be pure: no side effects on global state', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model' },
    ];

    // Call selectSlot multiple times
    for (let i = 0; i < 10; i++) {
      selectSlot('test message', [], 'model', slots);
    }

    // Slots should remain unchanged
    expect(slots[0].id).to.equal(0);
    expect(slots[0].purpose).to.equal('primary');
    expect(slots[0].status).to.equal('running');
  });

  it('should handle null/undefined inputs without mutation', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model' },
    ];

    const originalSlots = JSON.parse(JSON.stringify(slots));

    // Call with various null/undefined inputs
    selectSlot(null, null, null, slots);
    selectSlot(undefined, undefined, undefined, slots);
    selectSlot('', [], '', slots);

    // Slots should not be mutated
    expect(JSON.stringify(slots)).to.equal(JSON.stringify(originalSlots));
  });

  it('should be deterministic across different input types', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model1' },
      { id: 1, purpose: 'coding', status: 'running', modelPath: 'model2' },
    ];

    // Test with code pattern
    const result1 = selectSlot('Here is some ```python code```', [], 'model1', slots);
    const result2 = selectSlot('Here is some ```python code```', [], 'model1', slots);
    expect(result1).to.equal(result2);

    // Test with JSON pattern
    const result3 = selectSlot('Return valid json', [], 'model1', slots);
    const result4 = selectSlot('Return valid json', [], 'model1', slots);
    expect(result3).to.equal(result4);

    // Test with image attachment
    const attachments = [{ type: 'image_url' }];
    const result5 = selectSlot('Analyze this', attachments, 'model1', slots);
    const result6 = selectSlot('Analyze this', attachments, 'model1', slots);
    expect(result5).to.equal(result6);
  });
});
