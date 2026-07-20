/**
 * Unit tests for tool-rewriter.js
 *
 * Tests the extractToolCalls and rewriteNonStreaming functions
 * for correct parsing and rewriting of tool-call markers.
 *
 * Run with: npm test -- desktop/tests/tool-rewriter.test.js
 */

const assert = require('assert');
const { extractToolCalls, rewriteNonStreaming, ToolRewriterStream } = require('../tool-rewriter');

describe('Tool_Rewriter', () => {
  describe('extractToolCalls', () => {
    it('should extract tool_call markers', () => {
      const text = '<tool_call>{"id":"call_1","name":"func","arguments":{"x":1}}</tool_call>';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, true);
      assert.strictEqual(result.toolCalls.length, 1);
      assert.strictEqual(result.toolCalls[0].function.name, 'func');
      assert.strictEqual(result.cleanedText, '');
    });

    it('should extract function_call markers', () => {
      const text = '<|function_call|>{"id":"call_1","name":"func","arguments":{"x":1}}<|/function_call|>';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, true);
      assert.strictEqual(result.toolCalls.length, 1);
      assert.strictEqual(result.toolCalls[0].function.name, 'func');
    });

    it('should handle multiple tool calls', () => {
      const text = '<tool_call>{"id":"call_1","name":"func1","arguments":{}}</tool_call><tool_call>{"id":"call_2","name":"func2","arguments":{}}</tool_call>';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, true);
      assert.strictEqual(result.toolCalls.length, 2);
      assert.strictEqual(result.toolCalls[0].function.name, 'func1');
      assert.strictEqual(result.toolCalls[1].function.name, 'func2');
    });

    it('should clean text by removing markers', () => {
      const text = 'Before <tool_call>{"id":"call_1","name":"func","arguments":{}}</tool_call> After';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, true);
      assert(result.cleanedText.includes('Before'));
      assert(result.cleanedText.includes('After'));
      assert(!result.cleanedText.includes('tool_call'));
    });

    it('should return empty result for non-string input', () => {
      const result = extractToolCalls(null);
      assert.strictEqual(result.hasMarkers, false);
      assert.strictEqual(result.toolCalls.length, 0);
      assert.strictEqual(result.cleanedText, '');
    });

    it('should return empty result when no markers present', () => {
      const text = 'Just plain text with no markers';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, false);
      assert.strictEqual(result.toolCalls.length, 0);
      assert.strictEqual(result.cleanedText, 'Just plain text with no markers');
    });

    it('should handle invalid JSON in markers gracefully', () => {
      const text = '<tool_call>invalid json</tool_call>';
      const result = extractToolCalls(text);

      assert.strictEqual(result.hasMarkers, true);
      assert.strictEqual(result.toolCalls.length, 0);
    });

    it('should convert arguments to string if needed', () => {
      const text = '<tool_call>{"id":"call_1","name":"func","arguments":{"x":1}}</tool_call>';
      const result = extractToolCalls(text);

      assert.strictEqual(typeof result.toolCalls[0].function.arguments, 'string');
      const args = JSON.parse(result.toolCalls[0].function.arguments);
      assert.strictEqual(args.x, 1);
    });

    it('should set type to "function"', () => {
      const text = '<tool_call>{"id":"call_1","name":"func","arguments":{}}</tool_call>';
      const result = extractToolCalls(text);

      assert.strictEqual(result.toolCalls[0].type, 'function');
    });

    it('should generate id if not provided', () => {
      const text = '<tool_call>{"name":"func","arguments":{}}</tool_call>';
      const result = extractToolCalls(text);

      assert(result.toolCalls[0].id);
      assert(result.toolCalls[0].id.length > 0);
    });
  });

  describe('rewriteNonStreaming', () => {
    it('should rewrite response with tool_call markers', () => {
      const body = {
        choices: [{
          message: {
            content: '<tool_call>{"id":"call_1","name":"func","arguments":{"x":1}}</tool_call>',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);
      const result = JSON.parse(rewritten.toString('utf8'));

      assert(result.choices[0].message.tool_calls);
      assert.strictEqual(result.choices[0].message.tool_calls.length, 1);
      assert.strictEqual(result.choices[0].message.tool_calls[0].function.name, 'func');
      assert.strictEqual(result.choices[0].message.content, '');
    });

    it('should rewrite response with function_call markers', () => {
      const body = {
        choices: [{
          message: {
            content: '<|function_call|>{"id":"call_1","name":"func","arguments":{"x":1}}<|/function_call|>',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);
      const result = JSON.parse(rewritten.toString('utf8'));

      assert(result.choices[0].message.tool_calls);
      assert.strictEqual(result.choices[0].message.tool_calls[0].function.name, 'func');
    });

    it('should preserve byte-identical output when no markers', () => {
      const body = {
        choices: [{
          message: {
            content: 'Just plain text',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);

      assert.strictEqual(buffer.toString('utf8'), rewritten.toString('utf8'));
    });

    it('should handle non-Buffer input', () => {
      const result = rewriteNonStreaming('not a buffer');
      assert.strictEqual(result, 'not a buffer');
    });

    it('should handle invalid JSON body', () => {
      const buffer = Buffer.from('not valid json', 'utf8');
      const rewritten = rewriteNonStreaming(buffer);

      assert.strictEqual(buffer.toString('utf8'), rewritten.toString('utf8'));
    });

    it('should handle response without choices field', () => {
      const body = { error: 'some error' };
      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);

      assert.strictEqual(buffer.toString('utf8'), rewritten.toString('utf8'));
    });

    it('should handle response with null content', () => {
      const body = {
        choices: [{
          message: {
            content: null,
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);

      assert.strictEqual(buffer.toString('utf8'), rewritten.toString('utf8'));
    });

    it('should handle multiple choices', () => {
      const body = {
        choices: [
          {
            message: {
              content: '<tool_call>{"id":"call_1","name":"func1","arguments":{}}</tool_call>',
              role: 'assistant'
            }
          },
          {
            message: {
              content: 'Plain text',
              role: 'assistant'
            }
          }
        ]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);
      const result = JSON.parse(rewritten.toString('utf8'));

      assert(result.choices[0].message.tool_calls);
      assert.strictEqual(result.choices[1].message.content, 'Plain text');
    });

    it('should be idempotent', () => {
      const body = {
        choices: [{
          message: {
            content: '<tool_call>{"id":"call_1","name":"func","arguments":{}}</tool_call>',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten1 = rewriteNonStreaming(buffer);
      const rewritten2 = rewriteNonStreaming(rewritten1);

      assert.strictEqual(rewritten1.toString('utf8'), rewritten2.toString('utf8'));
    });

    it('should handle mixed content with markers and text', () => {
      const body = {
        choices: [{
          message: {
            content: 'Before <tool_call>{"id":"call_1","name":"func","arguments":{}}</tool_call> After',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);
      const result = JSON.parse(rewritten.toString('utf8'));

      assert(result.choices[0].message.tool_calls);
      assert(result.choices[0].message.content.includes('Before'));
      assert(result.choices[0].message.content.includes('After'));
    });

    it('should handle invalid JSON in markers', () => {
      const body = {
        choices: [{
          message: {
            content: '<tool_call>invalid json</tool_call>',
            role: 'assistant'
          }
        }]
      };

      const buffer = Buffer.from(JSON.stringify(body), 'utf8');
      const rewritten = rewriteNonStreaming(buffer);

      // Should be unchanged
      assert.strictEqual(buffer.toString('utf8'), rewritten.toString('utf8'));
    });
  });

  describe('ToolRewriterStream', () => {
    it('should be a Transform stream', () => {
      const stream = new ToolRewriterStream();
      assert(stream instanceof require('stream').Transform);
    });

    it('should accept logger option', () => {
      const mockLogger = { warn: () => {} };
      const stream = new ToolRewriterStream({ logger: mockLogger });
      assert.strictEqual(stream.logger, mockLogger);
    });

    it('should use console as default logger', () => {
      const stream = new ToolRewriterStream();
      assert.strictEqual(stream.logger, console);
    });
  });
});
