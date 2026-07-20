/**
 * Property Test P18: detectToolSupport correctness
 *
 * Generate arbitrary strings (some containing markers in mixed case, some not)
 * and non-string inputs. Verify that detectToolSupport correctly identifies
 * tool support based on the presence of 'tool_call' or 'function_call' substrings
 * (case-insensitive).
 *
 * Validates: Requirements 14.2
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { detectToolSupport } = require('../../chat-template-detector');

/**
 * Oracle implementation of tool support detection
 */
function oracleDetectToolSupport(chatTemplate) {
  if (typeof chatTemplate !== 'string') {
    return false;
  }

  const lowerTemplate = chatTemplate.toLowerCase();
  return lowerTemplate.includes('tool_call') || lowerTemplate.includes('function_call');
}

describe('P18: detectToolSupport correctness', () => {
  it('should match oracle on all generated string inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        (chatTemplate) => {
          const actual = detectToolSupport(chatTemplate);
          const expected = oracleDetectToolSupport(chatTemplate);

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should return false for non-string inputs', () => {
    const nonStringInputs = [
      null,
      undefined,
      123,
      true,
      false,
      {},
      [],
      () => {},
      Symbol('test')
    ];

    nonStringInputs.forEach(input => {
      const result = detectToolSupport(input);
      expect(result).to.be.false;
    });
  });

  it('should detect tool_call marker (lowercase)', () => {
    const templates = [
      'This template supports tool_call',
      'tool_call is here',
      'prefix tool_call suffix',
      'tool_call',
      '...tool_call...'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should detect tool_call marker (uppercase)', () => {
    const templates = [
      'This template supports TOOL_CALL',
      'TOOL_CALL is here',
      'prefix TOOL_CALL suffix',
      'TOOL_CALL',
      'Tool_Call',
      'ToOl_CaLl'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should detect function_call marker (lowercase)', () => {
    const templates = [
      'This template supports function_call',
      'function_call is here',
      'prefix function_call suffix',
      'function_call',
      '...function_call...'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should detect function_call marker (uppercase)', () => {
    const templates = [
      'This template supports FUNCTION_CALL',
      'FUNCTION_CALL is here',
      'prefix FUNCTION_CALL suffix',
      'FUNCTION_CALL',
      'Function_Call',
      'FuNcTiOn_CaLl'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should detect mixed case markers', () => {
    const templates = [
      'Tool_Call',
      'TOOL_call',
      'tool_CALL',
      'Function_Call',
      'FUNCTION_call',
      'function_CALL'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should return false when markers are not present', () => {
    const templates = [
      'This is a regular template',
      'No markers here',
      'tool and call but not together',
      'function and call but not together',
      'toolcall without underscore',
      'functioncall without underscore',
      'tool_invoke is not the marker',
      'function_invoke is not the marker',
      ''
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.false;
    });
  });

  it('should detect both markers when both are present', () => {
    const templates = [
      'Supports both tool_call and function_call',
      'tool_call and function_call',
      'function_call and tool_call'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should handle markers at string boundaries', () => {
    const templates = [
      'tool_call',
      'function_call',
      'tool_call suffix',
      'prefix tool_call',
      'function_call suffix',
      'prefix function_call'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should handle markers with special characters around them', () => {
    const templates = [
      'tool_call\n',
      '\ntool_call',
      'tool_call\t',
      '\ttool_call',
      'tool_call\r\n',
      '\r\ntool_call',
      '(tool_call)',
      '[tool_call]',
      '{tool_call}',
      '"tool_call"',
      "'tool_call'",
      'function_call\n',
      '\nfunction_call',
      '(function_call)',
      '[function_call]'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should handle empty string', () => {
    const result = detectToolSupport('');
    expect(result).to.be.false;
  });

  it('should handle very long strings', () => {
    const longString = 'a'.repeat(10000) + 'tool_call' + 'b'.repeat(10000);
    const result = detectToolSupport(longString);
    expect(result).to.be.true;

    const longStringNoMarker = 'a'.repeat(20000);
    const result2 = detectToolSupport(longStringNoMarker);
    expect(result2).to.be.false;
  });

  it('should handle unicode characters', () => {
    const templates = [
      '你好 tool_call 世界',
      '🎉 function_call 🎉',
      'café tool_call naïve',
      'Ñoño function_call español'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should handle newlines and whitespace', () => {
    const templates = [
      'tool_call\n\n\n',
      '\n\n\ntool_call',
      'tool_call   ',
      '   tool_call',
      'function_call\n\n\n',
      '\n\n\nfunction_call'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should not match partial markers', () => {
    const templates = [
      'tool_cal',
      'tool_ca',
      'tool_c',
      'tool_',
      'tool',
      'function_cal',
      'function_ca',
      'function_c',
      'function_',
      'function',
      '_call',
      '_call_tool'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.false;
    });
  });

  it('should handle markers with numbers', () => {
    const templates = [
      'tool_call123',
      '123tool_call',
      'function_call456',
      '456function_call'
    ];

    templates.forEach(template => {
      const result = detectToolSupport(template);
      expect(result).to.be.true;
    });
  });

  it('should be deterministic', () => {
    const templates = [
      'tool_call',
      'function_call',
      'no markers',
      'TOOL_CALL',
      'FUNCTION_CALL',
      ''
    ];

    templates.forEach(template => {
      const result1 = detectToolSupport(template);
      const result2 = detectToolSupport(template);
      const result3 = detectToolSupport(template);

      expect(result1).to.equal(result2);
      expect(result2).to.equal(result3);
    });
  });

  it('should handle null and undefined explicitly', () => {
    expect(detectToolSupport(null)).to.be.false;
    expect(detectToolSupport(undefined)).to.be.false;
  });

  it('should handle object inputs', () => {
    expect(detectToolSupport({})).to.be.false;
    expect(detectToolSupport({ tool_call: true })).to.be.false;
    expect(detectToolSupport({ toString: () => 'tool_call' })).to.be.false;
  });

  it('should handle array inputs', () => {
    expect(detectToolSupport([])).to.be.false;
    expect(detectToolSupport(['tool_call'])).to.be.false;
  });

  it('should handle function inputs', () => {
    expect(detectToolSupport(() => 'tool_call')).to.be.false;
    expect(detectToolSupport(function() { return 'tool_call'; })).to.be.false;
  });

  it('should handle boolean inputs', () => {
    expect(detectToolSupport(true)).to.be.false;
    expect(detectToolSupport(false)).to.be.false;
  });

  it('should handle numeric inputs', () => {
    expect(detectToolSupport(0)).to.be.false;
    expect(detectToolSupport(1)).to.be.false;
    expect(detectToolSupport(-1)).to.be.false;
    expect(detectToolSupport(3.14)).to.be.false;
    expect(detectToolSupport(NaN)).to.be.false;
    expect(detectToolSupport(Infinity)).to.be.false;
  });

  it('should satisfy the oracle property for all generated inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 1000 }),
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.boolean()
        ),
        (input) => {
          const actual = detectToolSupport(input);
          const expected = oracleDetectToolSupport(input);

          expect(actual).to.equal(expected);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
