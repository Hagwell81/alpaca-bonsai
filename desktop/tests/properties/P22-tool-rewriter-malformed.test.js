/**
 * Property 22: Tool_Rewriter malformed-marker passthrough
 *
 * When markers wrap non-JSON text, the rewriter leaves the response
 * unchanged and logs a warning.
 *
 * Validates: Requirements 15.3
 */

const assert = require('assert');
const fc = require('fast-check');
const { rewriteNonStreaming } = require('../../tool-rewriter');

describe('P22: Tool_Rewriter malformed-marker passthrough', () => {
  it('should leave response unchanged when marker contains invalid JSON', () => {
    const property = fc.property(
      fc.string({ minLength: 1, maxLength: 100 }),
      (invalidJson) => {
        // Skip if it happens to be valid JSON
        try {
          JSON.parse(invalidJson);
          return true; // Skip this case
        } catch {
          // Good, it's invalid
        }

        const content = `<tool_call>${invalidJson}</tool_call>`;
        const body = {
          choices: [{
            message: {
              content,
              role: 'assistant'
            }
          }]
        };

        const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
        const rewritten = rewriteNonStreaming(bodyBuffer);

        // Should be byte-identical (unchanged)
        assert.strictEqual(bodyBuffer.toString('utf8'), rewritten.toString('utf8'));
      }
    );

    fc.assert(property, { numRuns: 100 });
  });

  it('should handle function_call marker with invalid JSON', () => {
    const content = '<|function_call|>not valid json<|/function_call|>';
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
    const rewritten = rewriteNonStreaming(bodyBuffer);

    // Should be byte-identical
    assert.strictEqual(bodyBuffer.toString('utf8'), rewritten.toString('utf8'));
  });

  it('should log warning when JSON is unparseable', () => {
    let warningLogged = false;
    let warningMessage = '';

    const originalWarn = console.warn;
    console.warn = (msg) => {
      warningLogged = true;
      warningMessage = msg;
    };

    try {
      const content = '<tool_call>{invalid json}</tool_call>';
      const body = {
        choices: [{
          message: {
            content,
            role: 'assistant'
          }
        }]
      };

      const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
      rewriteNonStreaming(bodyBuffer);

      assert(warningLogged, 'Warning should have been logged');
      assert(warningMessage.includes('Tool_Rewriter'), 'Warning should mention Tool_Rewriter');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should handle mixed valid and invalid markers', () => {
    const validToolCall = { id: 'call_1', name: 'func', arguments: {} };
    const content = `<tool_call>${JSON.stringify(validToolCall)}</tool_call><tool_call>invalid</tool_call>`;
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
    const rewritten = rewriteNonStreaming(bodyBuffer);
    const rewrittenBody = JSON.parse(rewritten.toString('utf8'));

    // Should have at least one valid tool call
    assert(rewrittenBody.choices[0].message.tool_calls);
    assert(rewrittenBody.choices[0].message.tool_calls.length >= 1);
  });

  it('should handle empty markers', () => {
    const content = '<tool_call></tool_call>';
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
    const rewritten = rewriteNonStreaming(bodyBuffer);

    // Should be byte-identical (empty JSON is invalid)
    assert.strictEqual(bodyBuffer.toString('utf8'), rewritten.toString('utf8'));
  });
});
