/**
 * Property Test P27: Tokenize/Detokenize Round-Trip
 *
 * For any valid UTF-8 string s accepted by the tokenizer,
 * detokenize(tokenize(s)) === s (round-trip property).
 *
 * This test uses a deterministic mock tokenizer that guarantees
 * round-trip consistency by construction.
 *
 * Validates: Requirements 17.4
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { tokenize, detokenize, verifyRoundTrip } = require('../helpers/mock-tokenizer');

describe('P27: Tokenize/Detokenize round-trip against mock tokenizer', () => {
  it('should round-trip any valid UTF-8 string', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          // Tokenize the text
          const tokens = tokenize(text);

          // Verify tokens is an array of integers
          expect(tokens).to.be.an('array');
          tokens.forEach((token) => {
            expect(token).to.be.a('number');
            expect(Number.isInteger(token)).to.be.true;
          });

          // Detokenize back to text
          const detokenized = detokenize(tokens);

          // Verify round-trip consistency
          expect(detokenized).to.equal(text);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle empty strings', () => {
    const text = '';
    const tokens = tokenize(text);
    expect(tokens).to.deep.equal([]);

    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal('');
  });

  it('should handle single characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1 }),
        (char) => {
          const tokens = tokenize(char);
          expect(tokens).to.have.lengthOf(1);

          const detokenized = detokenize(tokens);
          expect(detokenized).to.equal(char);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle ASCII characters', () => {
    const text = 'Hello, World!';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle Unicode characters', () => {
    const text = '你好世界🌍';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle mixed ASCII and Unicode', () => {
    const text = 'Hello 世界 🌍 World';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle special characters', () => {
    const text = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle whitespace characters', () => {
    const text = 'line1\nline2\ttab\rcarriage\fform\bbackspace';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle repeated characters', () => {
    const text = 'aaaaaabbbbbbcccccc';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle very long strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1000, maxLength: 10000 }),
        (text) => {
          const tokens = tokenize(text);
          const detokenized = detokenize(tokens);
          expect(detokenized).to.equal(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce consistent token sequences', () => {
    const text = 'test string';
    const tokens1 = tokenize(text);
    const tokens2 = tokenize(text);

    // Same input should produce identical token sequences
    expect(tokens1).to.deep.equal(tokens2);
  });

  it('should produce unique tokens for different characters', () => {
    const text = 'abc';
    const tokens = tokenize(text);

    // Each character should map to a different token
    expect(tokens[0]).to.not.equal(tokens[1]);
    expect(tokens[1]).to.not.equal(tokens[2]);
    expect(tokens[0]).to.not.equal(tokens[2]);
  });

  it('should handle tokens array with correct length', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          const tokens = tokenize(text);
          // Token count should equal character count
          expect(tokens).to.have.lengthOf(text.length);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should verify round-trip with helper function', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          const isConsistent = verifyRoundTrip(text);
          expect(isConsistent).to.be.true;
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle emoji and multi-codepoint characters', () => {
    const text = '😀😃😄😁';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle null bytes and control characters', () => {
    const text = 'before\x00after';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with only whitespace', () => {
    const text = '   \n\t\r   ';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with repeated patterns', () => {
    const text = 'abcabcabcabc';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should be idempotent: tokenize(detokenize(tokenize(x))) === tokenize(x)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          const tokens1 = tokenize(text);
          const detokenized = detokenize(tokens1);
          const tokens2 = tokenize(detokenized);

          // Tokenizing the detokenized result should produce the same tokens
          expect(tokens2).to.deep.equal(tokens1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle strings with line breaks and multiple lines', () => {
    const text = 'line1\nline2\nline3\nline4';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with JSON-like content', () => {
    const text = '{"key": "value", "number": 42, "array": [1, 2, 3]}';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with code snippets', () => {
    const text = 'function test() {\n  console.log("hello");\n}';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with URLs', () => {
    const text = 'https://example.com/path?query=value&other=123#anchor';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with HTML entities', () => {
    const text = '&lt;div&gt;&amp;&quot;&apos;&nbsp;&copy;&reg;&trade;';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with markdown syntax', () => {
    const text = '# Heading\n**bold** *italic* `code` [link](url)';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with mathematical symbols', () => {
    const text = '∑ ∫ ∂ ∇ ≈ ≠ ≤ ≥ ∞ √ ∛ ∜';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with currency symbols', () => {
    const text = '$ € £ ¥ ₹ ₽ ₩ ₪ ₦ ₨ ₱ ₡ ₲ ₴ ₵';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with arrows and geometric shapes', () => {
    const text = '← → ↑ ↓ ↔ ↕ ◀ ▶ ▲ ▼ ◆ ◇ ○ ●';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with combining diacritical marks', () => {
    const text = 'e\u0301 n\u0303 a\u0308'; // é ñ ä using combining marks
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with right-to-left characters', () => {
    const text = 'Hello שלום مرحبا';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with various scripts', () => {
    const text = 'Latin Ελληνικά Русский 日本語 한국어 العربية';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle very large token arrays', () => {
    // Create a string with many characters
    const text = 'a'.repeat(10000);
    const tokens = tokenize(text);
    expect(tokens).to.have.lengthOf(10000);

    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with null characters interspersed', () => {
    const text = 'a\x00b\x00c\x00d';
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with all printable ASCII characters', () => {
    let text = '';
    for (let i = 32; i < 127; i++) {
      text += String.fromCharCode(i);
    }
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should handle strings with all extended ASCII characters', () => {
    let text = '';
    for (let i = 128; i < 256; i++) {
      text += String.fromCharCode(i);
    }
    const tokens = tokenize(text);
    const detokenized = detokenize(tokens);
    expect(detokenized).to.equal(text);
  });

  it('should maintain round-trip property across multiple iterations', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          let current = text;
          // Perform multiple round-trips
          for (let i = 0; i < 5; i++) {
            const tokens = tokenize(current);
            current = detokenize(tokens);
          }
          // After multiple round-trips, should still equal original
          expect(current).to.equal(text);
        }
      ),
      { numRuns: 500 }
    );
  });
});
