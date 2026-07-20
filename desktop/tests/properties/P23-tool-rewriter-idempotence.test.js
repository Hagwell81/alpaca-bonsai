/**
 * Property 23: Tool_Rewriter idempotence
 *
 * Applying the Tool_Rewriter twice produces the same bytes as applying it once.
 * This is because a rewritten body has no tool-call markers, so the second pass
 * is a no-op.
 *
 * Validates: Requirements 15.5
 */

const assert = require('assert');
const fc = require('fast-check');
const { rewriteNonStreaming } = require('../../tool-rewriter');

describe('P23: Tool_Rewriter idempotence', () => {
  it('should be idempotent: rewrite(rewrite(b)) === rewrite(b)', () => {
    const property = fc.property(
      fc.record({
        choices: fc.array(
          fc.record({
            message: fc.record({
              content: fc.string({ maxLength: 500 }),
              role: fc.constantFrom('assistant', 'user')
            }),
            finish_reason: fc.constantFrom('stop', 'length', null)
          }),
          { minLength: 1, maxLength: 3 }
        )
      }),
      (body) => {
        const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

        // First rewrite
        const rewritten1 = rewriteNonStreaming(bodyBuffer);

        // Second rewrite
        const rewritten2 = rewriteNonStreaming(rewritten1);

        // Should be identical
        assert.strictEqual(
          rewritten1.toString('utf8'),
          rewritten2.toString('utf8'),
          'Second rewrite should produce identical output'
        );
      }
    );

    fc.assert(property, { numRuns: 100 });
  });

  it('should be idempotent with tool-call markers', () => {
    const toolCall = { id: 'call_1', name: 'func', arguments: { x: 1 } };
    const content = `<tool_call>${JSON.stringify(toolCall)}</tool_call>`;
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

    // First rewrite
    const rewritten1 = rewriteNonStreaming(bodyBuffer);
    const body1 = JSON.parse(rewritten1.toString('utf8'));

    // Second rewrite
    const rewritten2 = rewriteNonStreaming(rewritten1);
    const body2 = JSON.parse(rewritten2.toString('utf8'));

    // Should be identical
    assert.deepStrictEqual(body1, body2);
    assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
  });

  it('should be idempotent with function_call markers', () => {
    const toolCall = { id: 'call_1', name: 'func', arguments: { x: 1 } };
    const content = `<|function_call|>${JSON.stringify(toolCall)}<|/function_call|>`;
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

    // First rewrite
    const rewritten1 = rewriteNonStreaming(bodyBuffer);

    // Second rewrite
    const rewritten2 = rewriteNonStreaming(rewritten1);

    // Should be identical
    assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
  });

  it('should be idempotent with mixed content', () => {
    const toolCall = { id: 'call_1', name: 'func', arguments: {} };
    const content = `Some text before <tool_call>${JSON.stringify(toolCall)}</tool_call> and text after`;
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

    // First rewrite
    const rewritten1 = rewriteNonStreaming(bodyBuffer);

    // Second rewrite
    const rewritten2 = rewriteNonStreaming(rewritten1);

    // Should be identical
    assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
  });

  it('should be idempotent with multiple tool calls', () => {
    const toolCall1 = { id: 'call_1', name: 'func1', arguments: { x: 1 } };
    const toolCall2 = { id: 'call_2', name: 'func2', arguments: { y: 2 } };
    const content = `<tool_call>${JSON.stringify(toolCall1)}</tool_call><tool_call>${JSON.stringify(toolCall2)}</tool_call>`;
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

    // First rewrite
    const rewritten1 = rewriteNonStreaming(bodyBuffer);

    // Second rewrite
    const rewritten2 = rewriteNonStreaming(rewritten1);

    // Should be identical
    assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
  });

  it('should be idempotent with invalid JSON in markers', () => {
    const content = '<tool_call>invalid json</tool_call>';
    const body = {
      choices: [{
        message: {
          content,
          role: 'assistant'
        }
      }]
    };

    const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

    // First rewrite (should be unchanged due to invalid JSON)
    const rewritten1 = rewriteNonStreaming(bodyBuffer);

    // Second rewrite
    const rewritten2 = rewriteNonStreaming(rewritten1);

    // Should be identical
    assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
  });
});
