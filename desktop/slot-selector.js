/**
 * @fileoverview Pure slot selection function for routing requests to the optimal slot.
 * Implements Requirement 3: Smart Slot Assignment
 *
 * The selectSlot function is pure and deterministic:
 * - Never mutates any input
 * - Always returns the same result for the same inputs
 * - Returns an element of the slots array or null
 */

/**
 * Selects the best slot for a given request based on content and model.
 *
 * Routing rule table (in priority order):
 * 1. Exact model match: if a running slot's modelPath equals requestedModel, return it
 * 2. Image routing: if attachments contains an image and vision slot is running, return vision
 * 3. Code/JSON routing: if message matches /```|\bjson\b/i and coding slot is running, return coding
 * 4. Primary fallback: if primary slot is running, return primary
 * 5. Lowest-id fallback: return the lowest-id running slot
 * 6. No slots: return null if no slots are running
 *
 * @param {string} message - The user's message text
 * @param {Array} attachments - Array of attachment objects (may contain images)
 * @param {string} requestedModel - The requested model path/name
 * @param {Array} slots - Array of slot objects with { id, purpose, status, modelPath, ... }
 * @returns {Object|null} A slot object from the slots array, or null if no suitable slot found
 *
 * @example
 * const slot = selectSlot(
 *   "Here's some code:\n```python\nprint('hello')\n```",
 *   [],
 *   "gpt-4",
 *   slots
 * );
 * // Returns the coding slot if running, else primary if running, else lowest-id running
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
function selectSlot(message, attachments, requestedModel, slots) {
  // Validate inputs - ensure slots is an array
  if (!Array.isArray(slots)) {
    return null;
  }

  // Rule 1: Exact model match
  // If a running slot's modelPath equals requestedModel, return it
  for (const slot of slots) {
    if (
      slot.status === 'running' &&
      slot.modelPath === requestedModel
    ) {
      return slot;
    }
  }

  // Rule 2: Image routing
  // If attachments contains an image and vision slot is running, return vision
  if (Array.isArray(attachments) && attachments.length > 0) {
    const hasImage = attachments.some(att => att && att.type === 'image_url');
    if (hasImage) {
      const visionSlot = slots.find(s => s.purpose === 'vision' && s.status === 'running');
      if (visionSlot) {
        return visionSlot;
      }
    }
  }

  // Rule 3: Code/JSON routing
  // If message matches /```|\bjson\b/i and coding slot is running, return coding
  if (typeof message === 'string' && /```|\bjson\b/i.test(message)) {
    const codingSlot = slots.find(s => s.purpose === 'coding' && s.status === 'running');
    if (codingSlot) {
      return codingSlot;
    }
  }

  // Rule 4: Primary fallback
  // If primary slot is running, return primary
  const primarySlot = slots.find(s => s.purpose === 'primary' && s.status === 'running');
  if (primarySlot) {
    return primarySlot;
  }

  // Rule 5: Lowest-id fallback
  // Return the lowest-id running slot
  const runningSlots = slots.filter(s => s.status === 'running');
  if (runningSlots.length > 0) {
    // Sort by id ascending and return the first (lowest-id)
    runningSlots.sort((a, b) => a.id - b.id);
    return runningSlots[0];
  }

  // Rule 6: No slots running
  // Return null if no slots are running
  return null;
}

module.exports = {
  selectSlot,
};
