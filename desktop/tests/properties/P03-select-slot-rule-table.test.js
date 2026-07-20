/**
 * Property Test P3: selectSlot routing rule table
 *
 * For any slots array (length 5, with arbitrary statuses) and (message, attachments, requestedModel)
 * tuple, the result of selectSlot matches the following oracle computed from the inputs alone:
 * (a) if a running slot's modelPath == requestedModel, return it
 * (b) else if attachments contains an image and vision slot is running, return vision
 * (c) else if message matches /```|\bjson\b/i and coding slot is running, return coding
 * (d) else if primary is running, return primary
 * (e) else return the lowest-id running slot, or null if none
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { selectSlot } = require('../../slot-selector');

/**
 * Oracle implementation of the routing rules
 * This is an independent reference implementation to compare against
 */
function oracleSelectSlot(message, attachments, requestedModel, slots) {
  if (!Array.isArray(slots)) {
    return null;
  }

  // Rule (a): Exact model match
  for (const slot of slots) {
    if (slot.status === 'running' && slot.modelPath === requestedModel) {
      return slot;
    }
  }

  // Rule (b): Image routing to vision
  if (Array.isArray(attachments) && attachments.length > 0) {
    const hasImage = attachments.some(att => att && att.type === 'image_url');
    if (hasImage) {
      const visionSlot = slots.find(s => s.purpose === 'vision' && s.status === 'running');
      if (visionSlot) {
        return visionSlot;
      }
    }
  }

  // Rule (c): Code/JSON routing to coding
  if (typeof message === 'string' && /```|\bjson\b/i.test(message)) {
    const codingSlot = slots.find(s => s.purpose === 'coding' && s.status === 'running');
    if (codingSlot) {
      return codingSlot;
    }
  }

  // Rule (d): Primary fallback
  const primarySlot = slots.find(s => s.purpose === 'primary' && s.status === 'running');
  if (primarySlot) {
    return primarySlot;
  }

  // Rule (e): Lowest-id running slot
  const runningSlots = slots.filter(s => s.status === 'running');
  if (runningSlots.length > 0) {
    runningSlots.sort((a, b) => a.id - b.id);
    return runningSlots[0];
  }

  return null;
}

describe('P3: selectSlot routing rule table', () => {
  it('should match oracle implementation on all generated inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.array(
          fc.record({
            type: fc.constantFrom('image_url', 'text', 'video_url'),
            url: fc.option(fc.string({ maxLength: 100 }), { freq: 2 })
          }),
          { maxLength: 5 }
        ),
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
          const actual = selectSlot(message, attachments, requestedModel, slots);
          const expected = oracleSelectSlot(message, attachments, requestedModel, slots);

          // Both should be null or both should have the same id
          if (expected === null) {
            expect(actual).to.be.null;
          } else {
            expect(actual).to.not.be.null;
            expect(actual.id).to.equal(expected.id);
            expect(actual.purpose).to.equal(expected.purpose);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should apply rule (a): exact model match takes priority', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 1, purpose: 'secondary', status: 'running', modelPath: 'model-b' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' }
    ];

    // Request model-b should return slot 1 even though primary is running
    const result = selectSlot('', [], 'model-b', slots);
    expect(result.id).to.equal(1);
    expect(result.modelPath).to.equal('model-b');
  });

  it('should apply rule (b): image routing to vision when no exact match', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' }
    ];

    const attachments = [{ type: 'image_url', url: 'http://example.com/image.jpg' }];
    const result = selectSlot('analyze this image', attachments, 'model-b', slots);
    expect(result.id).to.equal(2);
    expect(result.purpose).to.equal('vision');
  });

  it('should apply rule (c): code/JSON routing to coding when no image', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    // Message with code block
    const result1 = selectSlot('Here is some ```python code```', [], 'model-b', slots);
    expect(result1.id).to.equal(4);
    expect(result1.purpose).to.equal('coding');

    // Message with json keyword
    const result2 = selectSlot('Return valid JSON', [], 'model-b', slots);
    expect(result2.id).to.equal(4);
    expect(result2.purpose).to.equal('coding');
  });

  it('should apply rule (d): primary fallback when no prior rules match', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 1, purpose: 'secondary', status: 'idle', modelPath: null },
      { id: 2, purpose: 'vision', status: 'idle', modelPath: null },
      { id: 4, purpose: 'coding', status: 'idle', modelPath: null }
    ];

    const result = selectSlot('plain text message', [], 'model-b', slots);
    expect(result.id).to.equal(0);
    expect(result.purpose).to.equal('primary');
  });

  it('should apply rule (e): lowest-id running slot when primary is not running', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'idle', modelPath: null },
      { id: 1, purpose: 'secondary', status: 'running', modelPath: 'model-b' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    const result = selectSlot('plain text', [], 'model-x', slots);
    expect(result.id).to.equal(1); // Lowest-id running slot
    expect(result.purpose).to.equal('secondary');
  });

  it('should return null when no slots are running', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'idle', modelPath: null },
      { id: 1, purpose: 'secondary', status: 'error', modelPath: null },
      { id: 2, purpose: 'vision', status: 'stopping', modelPath: null }
    ];

    const result = selectSlot('any message', [], 'any-model', slots);
    expect(result).to.be.null;
  });

  it('should prioritize exact match over image routing', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-b' }
    ];

    const attachments = [{ type: 'image_url' }];
    // Request model-a (exact match) should return primary, not vision
    const result = selectSlot('analyze image', attachments, 'model-a', slots);
    expect(result.id).to.equal(0);
    expect(result.modelPath).to.equal('model-a');
  });

  it('should prioritize image routing over code routing', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    const attachments = [{ type: 'image_url' }];
    // Message with code pattern but has image attachment
    const result = selectSlot('analyze this ```code``` in the image', attachments, 'model-b', slots);
    expect(result.id).to.equal(2);
    expect(result.purpose).to.equal('vision');
  });

  it('should prioritize code routing over primary fallback', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    const result = selectSlot('write this ```python code```', [], 'model-b', slots);
    expect(result.id).to.equal(4);
    expect(result.purpose).to.equal('coding');
  });

  it('should handle case-insensitive code pattern matching', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    // Test various case combinations
    const patterns = [
      'return JSON',
      'return json',
      'return Json',
      'return jSoN',
      'here is ```code```',
      'here is ```CODE```'
    ];

    patterns.forEach(pattern => {
      const result = selectSlot(pattern, [], 'model-b', slots);
      expect(result.id).to.equal(4, `Pattern "${pattern}" should route to coding`);
    });
  });

  it('should handle word boundary for json keyword', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 4, purpose: 'coding', status: 'running', modelPath: 'model-e' }
    ];

    // Should match "json" as a word
    const result1 = selectSlot('return json', [], 'model-b', slots);
    expect(result1.id).to.equal(4);

    // Should match "json" in "jsonify"? No, word boundary should prevent this
    // Actually, \bjson\b requires word boundaries, so "jsonify" should NOT match
    const result2 = selectSlot('jsonify the data', [], 'model-b', slots);
    expect(result2.id).to.equal(0); // Should fall back to primary
  });

  it('should handle empty attachments array', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' }
    ];

    const result = selectSlot('message', [], 'model-b', slots);
    expect(result.id).to.equal(0); // Should use primary, not vision
  });

  it('should handle attachments without image_url type', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' }
    ];

    const attachments = [
      { type: 'text', content: 'some text' },
      { type: 'video_url', url: 'http://example.com/video.mp4' }
    ];

    const result = selectSlot('message', attachments, 'model-b', slots);
    expect(result.id).to.equal(0); // Should use primary, not vision
  });

  it('should handle mixed attachment types with at least one image', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' },
      { id: 2, purpose: 'vision', status: 'running', modelPath: 'model-c' }
    ];

    const attachments = [
      { type: 'text', content: 'some text' },
      { type: 'image_url', url: 'http://example.com/image.jpg' }
    ];

    const result = selectSlot('message', attachments, 'model-b', slots);
    expect(result.id).to.equal(2); // Should use vision because image is present
  });

  it('should handle null/undefined inputs gracefully', () => {
    const slots = [
      { id: 0, purpose: 'primary', status: 'running', modelPath: 'model-a' }
    ];

    // Should not throw and should use primary
    const result1 = selectSlot(null, null, null, slots);
    expect(result1.id).to.equal(0);

    const result2 = selectSlot(undefined, undefined, undefined, slots);
    expect(result2.id).to.equal(0);
  });

  it('should handle non-array slots input', () => {
    const result = selectSlot('message', [], 'model', null);
    expect(result).to.be.null;

    const result2 = selectSlot('message', [], 'model', undefined);
    expect(result2).to.be.null;

    const result3 = selectSlot('message', [], 'model', {});
    expect(result3).to.be.null;
  });
});
