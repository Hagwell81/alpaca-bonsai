/**
 * Mock Tokenizer for Property-Based Testing
 *
 * A deterministic mock tokenizer that guarantees round-trip consistency:
 * detokenize(tokenize(text)) === text for any valid UTF-8 string.
 *
 * The tokenizer uses a simple but deterministic encoding:
 * - Each Unicode character is mapped to a unique token ID
 * - Token IDs are assigned sequentially based on character code points
 * - Special handling for multi-byte UTF-8 sequences
 *
 * This ensures that the round-trip property holds by construction.
 */

/**
 * Tokenize a string into an array of token IDs
 * Each character becomes a unique token ID based on its Unicode code point
 *
 * @param {string} text - The text to tokenize
 * @returns {number[]} Array of token IDs
 */
function tokenize(text) {
  if (typeof text !== 'string') {
    throw new TypeError('tokenize expects a string');
  }

  const tokens = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const codePoint = char.charCodeAt(0);
    // Map character code point to token ID
    // Add 1 to avoid token ID 0 (often reserved in real tokenizers)
    tokens.push(codePoint + 1);
  }
  return tokens;
}

/**
 * Detokenize an array of token IDs back into a string
 * Reverses the tokenization by converting token IDs back to characters
 *
 * @param {number[]} tokens - Array of token IDs
 * @returns {string} The detokenized text
 */
function detokenize(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError('detokenize expects an array');
  }

  let text = '';
  for (const token of tokens) {
    if (typeof token !== 'number' || !Number.isInteger(token)) {
      throw new TypeError(`Invalid token: ${token}. Expected integer.`);
    }
    // Reverse the tokenization: subtract 1 to get back the original code point
    const codePoint = token - 1;
    if (codePoint < 0 || codePoint > 0x10FFFF) {
      throw new RangeError(`Invalid code point: ${codePoint}`);
    }
    text += String.fromCharCode(codePoint);
  }
  return text;
}

/**
 * Verify round-trip consistency
 * For testing purposes: ensures detokenize(tokenize(text)) === text
 *
 * @param {string} text - The text to verify
 * @returns {boolean} True if round-trip is consistent
 */
function verifyRoundTrip(text) {
  if (typeof text !== 'string') {
    return false;
  }
  try {
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    return detokenized === text;
  } catch {
    return false;
  }
}

module.exports = {
  tokenize,
  detokenize,
  verifyRoundTrip,
};
