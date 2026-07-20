/**
 * Property Test P21: Tool_Rewriter preservation
 *
 * For any response that contains no tool-call markers, rewrite(r) == r (byte-identical).
 * Generate response bodies guaranteed not to contain either marker substring.
 *
 * Validates: Requirements 15.4
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { rewriteNonStreaming } = require('../../tool-rewriter');

/**
 * Generate a response body that is guaranteed NOT to contain tool-call markers
 */
const responseWithoutMarkersArbitrary = fc.record({
  choices: fc.array(
    fc.record({
      message: fc.record({
        content: fc.string({
          maxLength: 500,
          // Exclude the marker substrings
          blacklist: ['<tool_call>', '</tool_call>', '<|function_call|>', '<|/function_call|>']
        })
      })
    }),
    { minLength: 1, maxLength: 3 }
  )
});

describe('P21: Tool_Rewriter preservation', () => {
  it('should return byte-identical buffer when no markers are present', () => {
    fc.assert(
      fc.property(
        responseWithoutMarkersArbitrary,
        (response) => {
          const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
          const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

          // Buffers should be identical
          expect(rewrittenBuffer).to.deep.equal(originalBuffer);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should not modify response without tool_call markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'This is a normal response without any markers'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should not modify response without function_call markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'This response mentions function and call but not as markers'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with similar but not exact markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'This has <tool_calls> (plural) and <|function_calls|> (plural) but not the exact markers'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with partial markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'This has <tool_cal and function_cal but not complete markers'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with multiple choices', () => {
    const response = {
      choices: [
        { message: { content: 'First choice' } },
        { message: { content: 'Second choice' } },
        { message: { content: 'Third choice' } }
      ]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with empty content', () => {
    const response = {
      choices: [{
        message: {
          content: ''
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with special characters but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?/~`'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with unicode but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Unicode: 你好世界 🎉 café naïve'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with newlines but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Line 1\nLine 2\nLine 3\n\nLine 5'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with tabs and whitespace but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Text\twith\ttabs\n  and  spaces  '
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with very long content but no markers', () => {
    const longContent = 'a'.repeat(10000);
    const response = {
      choices: [{
        message: {
          content: longContent
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with JSON-like content but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: '{"key": "value", "nested": {"inner": "data"}}'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with code-like content but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'function test() { return "hello"; }'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with HTML-like content but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: '<div class="container"><p>Hello</p></div>'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with markdown but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: '# Heading\n\n**Bold** and *italic* text\n\n- List item 1\n- List item 2'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with angle brackets but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Math: 5 < 10 and 20 > 15'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with pipes but no markers', () => {
    const response = {
      choices: [{
        message: {
          content: 'Pipe character: | and double pipe: ||'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with additional fields', () => {
    const response = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        message: {
          role: 'assistant',
          content: 'This is a response'
        },
        finish_reason: 'stop',
        index: 0
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with null content', () => {
    const response = {
      choices: [{
        message: {
          content: null
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with missing content field', () => {
    const response = {
      choices: [{
        message: {
          role: 'assistant'
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with non-string content', () => {
    const response = {
      choices: [{
        message: {
          content: 123
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with missing choices field', () => {
    const response = {
      id: 'chatcmpl-123',
      object: 'chat.completion'
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with non-array choices', () => {
    const response = {
      choices: 'not an array'
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });

  it('should preserve response with empty choices array', () => {
    const response = {
      choices: []
    };

    const originalBuffer = Buffer.from(JSON.stringify(response), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);

    expect(rewrittenBuffer).to.deep.equal(originalBuffer);
  });
});
