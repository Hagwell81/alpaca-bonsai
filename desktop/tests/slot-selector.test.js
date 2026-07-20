/**
 * @fileoverview Unit tests for slot-selector.js
 * Tests the selectSlot function against Requirement 3 acceptance criteria
 */

const { expect } = require('chai');
const { selectSlot } = require('../slot-selector');

describe('selectSlot', () => {
  // Helper to create a slot object
  function createSlot(id, purpose, status = 'running', modelPath = null) {
    return {
      id,
      purpose,
      status,
      modelPath,
      port: 13434 + id,
    };
  }

  describe('Rule 1: Exact model match', () => {
    it('should return slot with exact model match when running', () => {
      const slots = [
        createSlot(0, 'primary', 'running', '/path/to/model-a'),
        createSlot(1, 'secondary', 'running', '/path/to/model-b'),
      ];

      const result = selectSlot('hello', [], '/path/to/model-b', slots);
      expect(result).to.equal(slots[1]);
    });

    it('should not return slot with exact model match if not running', () => {
      const slots = [
        createSlot(0, 'primary', 'running', '/path/to/model-a'),
        createSlot(1, 'secondary', 'idle', '/path/to/model-b'),
      ];

      const result = selectSlot('hello', [], '/path/to/model-b', slots);
      expect(result).to.equal(slots[0]); // Falls through to primary
    });

    it('should prioritize exact match over other rules', () => {
      const slots = [
        createSlot(0, 'primary', 'running', '/path/to/model-a'),
        createSlot(2, 'vision', 'running', '/path/to/model-b'),
      ];

      // Message has code markers and attachment has image, but exact match should win
      const result = selectSlot('```python\ncode', [{ type: 'image_url' }], '/path/to/model-b', slots);
      expect(result).to.equal(slots[1]);
    });
  });

  describe('Rule 2: Image routing', () => {
    it('should return vision slot when attachments contain image', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result = selectSlot('hello', [{ type: 'image_url', url: 'http://example.com/img.jpg' }], 'model', slots);
      expect(result).to.equal(slots[1]);
    });

    it('should not return vision slot if not running', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'idle'),
      ];

      const result = selectSlot('hello', [{ type: 'image_url' }], 'model', slots);
      expect(result).to.equal(slots[0]); // Falls through to primary
    });

    it('should ignore non-image attachments', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result = selectSlot('hello', [{ type: 'file' }], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary, not vision
    });

    it('should handle empty attachments array', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary, not vision
    });

    it('should handle null attachments', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result = selectSlot('hello', null, 'model', slots);
      expect(result).to.equal(slots[0]); // Primary, not vision
    });
  });

  describe('Rule 3: Code/JSON routing', () => {
    it('should return coding slot when message contains code fence', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('Here is code:\n```python\nprint("hello")\n```', [], 'model', slots);
      expect(result).to.equal(slots[1]);
    });

    it('should return coding slot when message contains json word', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('Please return JSON format', [], 'model', slots);
      expect(result).to.equal(slots[1]);
    });

    it('should match json case-insensitively', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('Please return JSON format', [], 'model', slots);
      expect(result).to.equal(slots[1]);

      const result2 = selectSlot('Please return Json format', [], 'model', slots);
      expect(result2).to.equal(slots[1]);

      const result3 = selectSlot('Please return json format', [], 'model', slots);
      expect(result3).to.equal(slots[1]);
    });

    it('should not match json as substring (word boundary)', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      // "jsonify" should not match because \b requires word boundary
      const result = selectSlot('Please jsonify the data', [], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary, not coding
    });

    it('should not return coding slot if not running', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'idle'),
      ];

      const result = selectSlot('```python\ncode', [], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary, not coding
    });
  });

  describe('Rule 4: Primary fallback', () => {
    it('should return primary slot when no other rules match', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(1, 'secondary', 'running'),
      ];

      const result = selectSlot('hello world', [], 'model', slots);
      expect(result).to.equal(slots[0]);
    });

    it('should not return primary if not running', () => {
      const slots = [
        createSlot(0, 'primary', 'idle'),
        createSlot(1, 'secondary', 'running'),
      ];

      const result = selectSlot('hello world', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Falls through to lowest-id running
    });
  });

  describe('Rule 5: Lowest-id fallback', () => {
    it('should return lowest-id running slot when primary is not running', () => {
      const slots = [
        createSlot(0, 'primary', 'idle'),
        createSlot(1, 'secondary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Slot 1 is lowest-id running
    });

    it('should return lowest-id running slot among multiple running slots', () => {
      const slots = [
        createSlot(0, 'primary', 'idle'),
        createSlot(2, 'vision', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Slot 2 is lowest-id running
    });
  });

  describe('Rule 6: No slots running', () => {
    it('should return null when no slots are running', () => {
      const slots = [
        createSlot(0, 'primary', 'idle'),
        createSlot(1, 'secondary', 'idle'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.be.null;
    });

    it('should return null when slots array is empty', () => {
      const result = selectSlot('hello', [], 'model', []);
      expect(result).to.be.null;
    });

    it('should return null when slots is not an array', () => {
      const result = selectSlot('hello', [], 'model', null);
      expect(result).to.be.null;

      const result2 = selectSlot('hello', [], 'model', {});
      expect(result2).to.be.null;
    });
  });

  describe('Purity and determinism', () => {
    it('should not mutate the slots array', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(1, 'secondary', 'running'),
      ];

      const slotsCopy = JSON.parse(JSON.stringify(slots));

      selectSlot('hello', [], 'model', slots);

      expect(slots).to.deep.equal(slotsCopy);
    });

    it('should not mutate individual slot objects', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
      ];

      const slotCopy = JSON.parse(JSON.stringify(slots[0]));

      selectSlot('hello', [], 'model', slots);

      expect(slots[0]).to.deep.equal(slotCopy);
    });

    it('should return the same result for identical inputs', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const result1 = selectSlot('hello', [], 'model', slots);
      const result2 = selectSlot('hello', [], 'model', slots);

      expect(result1).to.equal(result2);
    });

    it('should return the exact same object reference from slots array', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(1, 'secondary', 'running'),
      ];

      const result = selectSlot('hello', [], 'model', slots);

      expect(slots).to.include(result);
    });
  });

  describe('Edge cases', () => {
    it('should handle message as non-string gracefully', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot(null, [], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary

      const result2 = selectSlot(undefined, [], 'model', slots);
      expect(result2).to.equal(slots[0]); // Primary

      const result3 = selectSlot(123, [], 'model', slots);
      expect(result3).to.equal(slots[0]); // Primary
    });

    it('should handle requestedModel as non-string gracefully', () => {
      const slots = [
        createSlot(0, 'primary', 'running', '/path/to/model'),
      ];

      const result = selectSlot('hello', [], null, slots);
      expect(result).to.equal(slots[0]); // Primary (no exact match)

      const result2 = selectSlot('hello', [], undefined, slots);
      expect(result2).to.equal(slots[0]); // Primary (no exact match)
    });

    it('should handle slots with missing fields gracefully', () => {
      const slots = [
        { id: 0, purpose: 'primary', status: 'running' }, // No modelPath
        { id: 1, purpose: 'secondary', status: 'running' },
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.equal(slots[0]); // Primary
    });

    it('should handle multiple images in attachments', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const attachments = [
        { type: 'image_url', url: 'http://example.com/img1.jpg' },
        { type: 'image_url', url: 'http://example.com/img2.jpg' },
      ];

      const result = selectSlot('hello', attachments, 'model', slots);
      expect(result).to.equal(slots[1]); // Vision
    });

    it('should handle mixed attachment types', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
      ];

      const attachments = [
        { type: 'file' },
        { type: 'image_url', url: 'http://example.com/img.jpg' },
        { type: 'text' },
      ];

      const result = selectSlot('hello', attachments, 'model', slots);
      expect(result).to.equal(slots[1]); // Vision
    });

    it('should handle code fence at start of message', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('```\ncode here', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Coding
    });

    it('should handle code fence at end of message', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('code here\n```', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Coding
    });

    it('should handle multiple code fences', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('```\ncode1\n```\nmore\n```\ncode2\n```', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Coding
    });
  });

  describe('Complex routing scenarios', () => {
    it('should prioritize exact match over image routing', () => {
      const slots = [
        createSlot(0, 'primary', 'running', '/path/to/model-a'),
        createSlot(2, 'vision', 'running', '/path/to/model-b'),
      ];

      const result = selectSlot('hello', [{ type: 'image_url' }], '/path/to/model-b', slots);
      expect(result).to.equal(slots[1]); // Exact match wins
    });

    it('should prioritize image routing over code routing', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(2, 'vision', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('```python\ncode', [{ type: 'image_url' }], 'model', slots);
      expect(result).to.equal(slots[1]); // Vision (image) wins over coding
    });

    it('should prioritize code routing over primary', () => {
      const slots = [
        createSlot(0, 'primary', 'running'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('```python\ncode', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Coding wins over primary
    });

    it('should handle all slots in error state', () => {
      const slots = [
        createSlot(0, 'primary', 'error'),
        createSlot(1, 'secondary', 'error'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.be.null;
    });

    it('should handle all slots in starting state', () => {
      const slots = [
        createSlot(0, 'primary', 'starting'),
        createSlot(1, 'secondary', 'starting'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.be.null;
    });

    it('should handle mixed slot states', () => {
      const slots = [
        createSlot(0, 'primary', 'starting'),
        createSlot(1, 'secondary', 'running'),
        createSlot(2, 'vision', 'error'),
        createSlot(3, 'embedding', 'idle'),
        createSlot(4, 'coding', 'running'),
      ];

      const result = selectSlot('hello', [], 'model', slots);
      expect(result).to.equal(slots[1]); // Lowest-id running (slot 1)
    });
  });
});
