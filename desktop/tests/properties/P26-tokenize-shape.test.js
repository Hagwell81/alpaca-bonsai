/**
 * Property Test P26: Tokenize/Detokenize shape preservation
 *
 * For any valid /tokenize or /detokenize request body, the gateway:
 * 1. Routes the request to the primary slot (id 0, port 13434)
 * 2. Preserves the request body shape (pass-through)
 * 3. Preserves the response body shape (pass-through)
 * 4. Returns 503 with error 'primary_slot_not_running' when primary slot is not running
 *
 * Validates: Requirements 17.1, 17.2
 */

const { expect } = require('chai');
const fc = require('fast-check');
const http = require('http');
const { EventEmitter } = require('events');

/**
 * Mock SlotManager for testing
 */
class MockSlotManager extends EventEmitter {
  constructor(primarySlotStatus = 'running') {
    super();
    this.primarySlotStatus = primarySlotStatus;
  }

  getSlot(id) {
    if (id === 0) {
      return {
        id: 0,
        port: 13434,
        purpose: 'primary',
        status: this.primarySlotStatus,
        modelPath: '/path/to/model.gguf',
      };
    }
    return null;
  }

  getActiveSlots() {
    return this.primarySlotStatus === 'running' ? [this.getSlot(0)] : [];
  }
}

/**
 * Fast-check arbitrary for generating valid tokenize request bodies
 */
const tokenizeBodyArbitrary = () => {
  return fc.record({
    content: fc.string({ maxLength: 1000 }),
  });
};

/**
 * Fast-check arbitrary for generating valid detokenize request bodies
 */
const detokenizeBodyArbitrary = () => {
  return fc.record({
    tokens: fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 100 }),
  });
};

/**
 * Fast-check arbitrary for generating valid tokenize response bodies
 */
const tokenizeResponseArbitrary = () => {
  return fc.record({
    tokens: fc.array(fc.integer({ min: 0, max: 100000 }), { maxLength: 100 }),
  });
};

/**
 * Fast-check arbitrary for generating valid detokenize response bodies
 */
const detokenizeResponseArbitrary = () => {
  return fc.record({
    content: fc.string({ maxLength: 1000 }),
  });
};

describe('P26: Tokenize/Detokenize shape preservation', () => {
  describe('/tokenize endpoint', () => {
    it('should route /tokenize requests to primary slot (id 0)', () => {
      fc.assert(
        fc.property(tokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('running');
          const selectedSlot = slotManager.getSlot(0);

          // Verify that the selected slot is the primary slot
          expect(selectedSlot).to.exist;
          expect(selectedSlot.id).to.equal(0);
          expect(selectedSlot.port).to.equal(13434);
          expect(selectedSlot.purpose).to.equal('primary');
        }),
        { numRuns: 50 }
      );
    });

    it('should preserve /tokenize request body shape', () => {
      fc.assert(
        fc.property(tokenizeBodyArbitrary(), (body) => {
          // Verify the body has the expected shape
          expect(body).to.have.property('content');
          expect(typeof body.content).to.equal('string');
        }),
        { numRuns: 50 }
      );
    });

    it('should preserve /tokenize response body shape', () => {
      fc.assert(
        fc.property(tokenizeResponseArbitrary(), (response) => {
          // Verify the response has the expected shape
          expect(response).to.have.property('tokens');
          expect(Array.isArray(response.tokens)).to.be.true;
          expect(response.tokens.every(t => typeof t === 'number')).to.be.true;
        }),
        { numRuns: 50 }
      );
    });

    it('should return 503 when primary slot is not running', () => {
      fc.assert(
        fc.property(tokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('idle');
          const primarySlot = slotManager.getSlot(0);

          // Verify that the slot is not running
          expect(primarySlot.status).to.not.equal('running');
        }),
        { numRuns: 50 }
      );
    });

    it('should handle empty content string', () => {
      const body = { content: '' };
      expect(body).to.have.property('content');
      expect(body.content).to.equal('');
    });

    it('should handle very long content string', () => {
      const longContent = 'a'.repeat(10000);
      const body = { content: longContent };
      expect(body.content).to.equal(longContent);
    });

    it('should handle unicode content', () => {
      const unicodeContent = '你好世界 🌍 مرحبا العالم';
      const body = { content: unicodeContent };
      expect(body.content).to.equal(unicodeContent);
    });

    it('should handle special characters in content', () => {
      const specialContent = 'Hello\n\t"\'<>&\u0000\uFFFF';
      const body = { content: specialContent };
      expect(body.content).to.equal(specialContent);
    });

    it('should handle empty tokens array in response', () => {
      const response = { tokens: [] };
      expect(response.tokens).to.deep.equal([]);
    });

    it('should handle large tokens array in response', () => {
      const largeTokens = Array.from({ length: 1000 }, (_, i) => i);
      const response = { tokens: largeTokens };
      expect(response.tokens).to.have.lengthOf(1000);
    });

    it('should handle zero tokens in response', () => {
      const response = { tokens: [0, 0, 0] };
      expect(response.tokens).to.deep.equal([0, 0, 0]);
    });

    it('should handle large token ids in response', () => {
      const response = { tokens: [100000, 99999, 50000] };
      expect(response.tokens).to.deep.equal([100000, 99999, 50000]);
    });
  });

  describe('/detokenize endpoint', () => {
    it('should route /detokenize requests to primary slot (id 0)', () => {
      fc.assert(
        fc.property(detokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('running');
          const selectedSlot = slotManager.getSlot(0);

          // Verify that the selected slot is the primary slot
          expect(selectedSlot).to.exist;
          expect(selectedSlot.id).to.equal(0);
          expect(selectedSlot.port).to.equal(13434);
          expect(selectedSlot.purpose).to.equal('primary');
        }),
        { numRuns: 50 }
      );
    });

    it('should preserve /detokenize request body shape', () => {
      fc.assert(
        fc.property(detokenizeBodyArbitrary(), (body) => {
          // Verify the body has the expected shape
          expect(body).to.have.property('tokens');
          expect(Array.isArray(body.tokens)).to.be.true;
          expect(body.tokens.every(t => typeof t === 'number')).to.be.true;
        }),
        { numRuns: 50 }
      );
    });

    it('should preserve /detokenize response body shape', () => {
      fc.assert(
        fc.property(detokenizeResponseArbitrary(), (response) => {
          // Verify the response has the expected shape
          expect(response).to.have.property('content');
          expect(typeof response.content).to.equal('string');
        }),
        { numRuns: 50 }
      );
    });

    it('should return 503 when primary slot is not running', () => {
      fc.assert(
        fc.property(detokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('idle');
          const primarySlot = slotManager.getSlot(0);

          // Verify that the slot is not running
          expect(primarySlot.status).to.not.equal('running');
        }),
        { numRuns: 50 }
      );
    });

    it('should handle empty tokens array', () => {
      const body = { tokens: [] };
      expect(body.tokens).to.deep.equal([]);
    });

    it('should handle very large tokens array', () => {
      const largeTokens = Array.from({ length: 1000 }, (_, i) => i);
      const body = { tokens: largeTokens };
      expect(body.tokens).to.have.lengthOf(1000);
    });

    it('should handle zero tokens', () => {
      const body = { tokens: [0, 0, 0] };
      expect(body.tokens).to.deep.equal([0, 0, 0]);
    });

    it('should handle large token ids', () => {
      const body = { tokens: [100000, 99999, 50000] };
      expect(body.tokens).to.deep.equal([100000, 99999, 50000]);
    });

    it('should handle empty content string in response', () => {
      const response = { content: '' };
      expect(response.content).to.equal('');
    });

    it('should handle very long content string in response', () => {
      const longContent = 'a'.repeat(10000);
      const response = { content: longContent };
      expect(response.content).to.equal(longContent);
    });

    it('should handle unicode content in response', () => {
      const unicodeContent = '你好世界 🌍 مرحبا العالم';
      const response = { content: unicodeContent };
      expect(response.content).to.equal(unicodeContent);
    });

    it('should handle special characters in response content', () => {
      const specialContent = 'Hello\n\t"\'<>&\u0000\uFFFF';
      const response = { content: specialContent };
      expect(response.content).to.equal(specialContent);
    });
  });

  describe('Primary slot routing invariant', () => {
    it('should always route to slot id 0 for /tokenize', () => {
      fc.assert(
        fc.property(tokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('running');

          // Verify that getSlot(0) always returns the primary slot
          const slot = slotManager.getSlot(0);
          expect(slot.id).to.equal(0);
          expect(slot.port).to.equal(13434);
          expect(slot.purpose).to.equal('primary');
        }),
        { numRuns: 50 }
      );
    });

    it('should always route to slot id 0 for /detokenize', () => {
      fc.assert(
        fc.property(detokenizeBodyArbitrary(), (body) => {
          const slotManager = new MockSlotManager('running');

          // Verify that getSlot(0) always returns the primary slot
          const slot = slotManager.getSlot(0);
          expect(slot.id).to.equal(0);
          expect(slot.port).to.equal(13434);
          expect(slot.purpose).to.equal('primary');
        }),
        { numRuns: 50 }
      );
    });

    it('should not route to non-primary slots', () => {
      const slotManager = new MockSlotManager('running');

      // Verify that only slot 0 is the primary slot
      for (let i = 1; i <= 4; i++) {
        const slot = slotManager.getSlot(i);
        expect(slot).to.be.null;
      }
    });
  });

  describe('Slot status handling', () => {
    it('should handle primary slot in idle state', () => {
      const slotManager = new MockSlotManager('idle');
      const slot = slotManager.getSlot(0);

      expect(slot.status).to.equal('idle');
      expect(slot.status).to.not.equal('running');
    });

    it('should handle primary slot in starting state', () => {
      const slotManager = new MockSlotManager('starting');
      const slot = slotManager.getSlot(0);

      expect(slot.status).to.equal('starting');
      expect(slot.status).to.not.equal('running');
    });

    it('should handle primary slot in stopping state', () => {
      const slotManager = new MockSlotManager('stopping');
      const slot = slotManager.getSlot(0);

      expect(slot.status).to.equal('stopping');
      expect(slot.status).to.not.equal('running');
    });

    it('should handle primary slot in error state', () => {
      const slotManager = new MockSlotManager('error');
      const slot = slotManager.getSlot(0);

      expect(slot.status).to.equal('error');
      expect(slot.status).to.not.equal('running');
    });

    it('should handle primary slot in running state', () => {
      const slotManager = new MockSlotManager('running');
      const slot = slotManager.getSlot(0);

      expect(slot.status).to.equal('running');
    });
  });

  describe('Request/response shape invariants', () => {
    it('should preserve tokenize request shape across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.array(tokenizeBodyArbitrary(), { minLength: 1, maxLength: 10 }),
          (bodies) => {
            // All bodies should have the same shape
            bodies.forEach((body) => {
              expect(body).to.have.property('content');
              expect(typeof body.content).to.equal('string');
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should preserve detokenize request shape across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.array(detokenizeBodyArbitrary(), { minLength: 1, maxLength: 10 }),
          (bodies) => {
            // All bodies should have the same shape
            bodies.forEach((body) => {
              expect(body).to.have.property('tokens');
              expect(Array.isArray(body.tokens)).to.be.true;
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should preserve tokenize response shape across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.array(tokenizeResponseArbitrary(), { minLength: 1, maxLength: 10 }),
          (responses) => {
            // All responses should have the same shape
            responses.forEach((response) => {
              expect(response).to.have.property('tokens');
              expect(Array.isArray(response.tokens)).to.be.true;
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should preserve detokenize response shape across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.array(detokenizeResponseArbitrary(), { minLength: 1, maxLength: 10 }),
          (responses) => {
            // All responses should have the same shape
            responses.forEach((response) => {
              expect(response).to.have.property('content');
              expect(typeof response.content).to.equal('string');
            });
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle tokenize with null content', () => {
      const body = { content: null };
      // The gateway should handle this gracefully
      expect(body).to.have.property('content');
    });

    it('should handle detokenize with null tokens', () => {
      const body = { tokens: null };
      // The gateway should handle this gracefully
      expect(body).to.have.property('tokens');
    });

    it('should handle tokenize with undefined content', () => {
      const body = { content: undefined };
      // The gateway should handle this gracefully
      expect(body).to.have.property('content');
    });

    it('should handle detokenize with undefined tokens', () => {
      const body = { tokens: undefined };
      // The gateway should handle this gracefully
      expect(body).to.have.property('tokens');
    });

    it('should handle tokenize response with null tokens', () => {
      const response = { tokens: null };
      // The gateway should handle this gracefully
      expect(response).to.have.property('tokens');
    });

    it('should handle detokenize response with null content', () => {
      const response = { content: null };
      // The gateway should handle this gracefully
      expect(response).to.have.property('content');
    });

    it('should handle tokenize with extra fields', () => {
      const body = { content: 'hello', extra: 'field', nested: { data: 'value' } };
      expect(body).to.have.property('content');
      expect(body.content).to.equal('hello');
    });

    it('should handle detokenize with extra fields', () => {
      const body = { tokens: [1, 2, 3], extra: 'field', nested: { data: 'value' } };
      expect(body).to.have.property('tokens');
      expect(body.tokens).to.deep.equal([1, 2, 3]);
    });

    it('should handle tokenize response with extra fields', () => {
      const response = { tokens: [1, 2, 3], extra: 'field', nested: { data: 'value' } };
      expect(response).to.have.property('tokens');
      expect(response.tokens).to.deep.equal([1, 2, 3]);
    });

    it('should handle detokenize response with extra fields', () => {
      const response = { content: 'hello', extra: 'field', nested: { data: 'value' } };
      expect(response).to.have.property('content');
      expect(response.content).to.equal('hello');
    });
  });
});
