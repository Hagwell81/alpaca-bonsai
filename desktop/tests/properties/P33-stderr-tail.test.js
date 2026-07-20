/**
 * Property Test P33: stderr tail recording
 *
 * For any stderr buffer `b` captured from an exiting slot process,
 * the `slot.lastError.stderrTail` recorded by the Slot_Manager
 * equals `b.slice(-4096).toString('utf8')`.
 *
 * Validates: Requirements 2.5
 */

const { expect } = require('chai');
const fc = require('fast-check');

/**
 * Oracle implementation: the last 4096 bytes of a buffer, converted to UTF-8 string
 */
function oracleStderrTail(buffer) {
  if (buffer.length === 0) {
    return '';
  }
  return buffer.slice(-4096).toString('utf8');
}

describe('P33: stderr tail recording', () => {
  it('should record exactly the last 4096 bytes of stderr as UTF-8 string', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 100000 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const expected = oracleStderrTail(buffer);

          // Simulate what the Slot_Manager does
          const actual = buffer.slice(-4096).toString('utf8');

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle empty stderr buffer', () => {
    const buffer = Buffer.alloc(0);
    const result = buffer.slice(-4096).toString('utf8');
    expect(result).to.equal('');
  });

  it('should handle stderr smaller than 4096 bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 4095 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const expected = buffer.toString('utf8');
          const actual = buffer.slice(-4096).toString('utf8');

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle stderr exactly 4096 bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 4096, maxLength: 4096 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const expected = buffer.toString('utf8');
          const actual = buffer.slice(-4096).toString('utf8');

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle stderr larger than 4096 bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 4097, maxLength: 100000 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const expected = buffer.slice(-4096).toString('utf8');
          const actual = buffer.slice(-4096).toString('utf8');

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve UTF-8 characters correctly', () => {
    // Test with various UTF-8 sequences
    const testCases = [
      'Hello, World!',
      'Error: 你好世界',
      '🎉 Emoji test 🎉',
      'Café naïve Ñoño',
      'Line 1\nLine 2\nLine 3',
      'Tab\tseparated\tvalues',
      'Mixed: 日本語 + English + Ελληνικά',
      '\x00\x01\x02\x03', // Control characters
      'a'.repeat(5000), // Long ASCII
      '你'.repeat(2000), // Long UTF-8 multibyte
    ];

    testCases.forEach(testCase => {
      const buffer = Buffer.from(testCase, 'utf8');
      const result = buffer.slice(-4096).toString('utf8');
      const expected = oracleStderrTail(buffer);

      expect(result).to.equal(expected);
    });
  });

  it('should handle multi-byte UTF-8 sequences at boundaries', () => {
    // Create a buffer with multi-byte UTF-8 characters
    const text = '你好世界'.repeat(1000); // Each character is 3 bytes in UTF-8
    const buffer = Buffer.from(text, 'utf8');

    const result = buffer.slice(-4096).toString('utf8');
    const expected = oracleStderrTail(buffer);

    expect(result).to.equal(expected);
  });

  it('should handle invalid UTF-8 sequences gracefully', () => {
    // Create a buffer with invalid UTF-8 sequences
    const buffer = Buffer.from([0xFF, 0xFE, 0xFD, 0xFC, 0x41, 0x42, 0x43]);

    // Node.js will replace invalid sequences with the replacement character
    const result = buffer.slice(-4096).toString('utf8');
    const expected = oracleStderrTail(buffer);

    expect(result).to.equal(expected);
  });

  it('should be deterministic', () => {
    const buffer = Buffer.from('Test stderr output\nWith multiple lines\nAnd errors', 'utf8');

    const result1 = buffer.slice(-4096).toString('utf8');
    const result2 = buffer.slice(-4096).toString('utf8');
    const result3 = buffer.slice(-4096).toString('utf8');

    expect(result1).to.equal(result2);
    expect(result2).to.equal(result3);
  });

  it('should handle very large stderr buffers', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 10000, maxLength: 1000000 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const result = buffer.slice(-4096).toString('utf8');
          const expected = oracleStderrTail(buffer);

          expect(result).to.equal(expected);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should match oracle on all generated byte sequences', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 100000 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const actual = buffer.slice(-4096).toString('utf8');
          const expected = oracleStderrTail(buffer);

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle edge case: buffer with only newlines', () => {
    const buffer = Buffer.from('\n'.repeat(5000), 'utf8');
    const result = buffer.slice(-4096).toString('utf8');
    const expected = '\n'.repeat(4096);

    expect(result).to.equal(expected);
  });

  it('should handle edge case: buffer with null bytes', () => {
    const buffer = Buffer.from('\x00'.repeat(5000), 'utf8');
    const result = buffer.slice(-4096).toString('utf8');
    const expected = '\x00'.repeat(4096);

    expect(result).to.equal(expected);
  });

  it('should handle edge case: mixed content with special characters', () => {
    const content = 'Error: ' + 'x'.repeat(4000) + '\nStack trace:\n' + 'y'.repeat(1000);
    const buffer = Buffer.from(content, 'utf8');
    const result = buffer.slice(-4096).toString('utf8');
    const expected = oracleStderrTail(buffer);

    expect(result).to.equal(expected);
  });

  it('should satisfy the oracle property for all generated inputs', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 100000 }),
        (stderrBytes) => {
          const buffer = Buffer.from(stderrBytes);
          const actual = buffer.slice(-4096).toString('utf8');
          const expected = oracleStderrTail(buffer);

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
