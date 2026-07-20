/**
 * Property Test P20: Tool_Rewriter round-trip
 *
 * For any generated tool-call object, parse(rewrite(format(tc))).tool_calls[0]
 * equals tc on name and arguments.
 *
 * Validates: Requirements 15.1
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { rewriteNonStreaming } = require('../../tool-rewriter');

/**
 * Generate a valid tool-call object
 */
const toolCallArbitrary = fc.record({
  id: fc.option(fc.string({ maxLength: 50 }), { freq: 2 }),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  arguments: fc.oneof(
    fc.json({ maxDepth: 2 }).map(obj => JSON.stringify(obj)), // Generate valid JSON strings
    fc.record({
      param1: fc.option(fc.string({ maxLength: 50 })),
      param2: fc.option(fc.integer())
    }, { withDeletedKeys: true })
  )
});

describe('P20: Tool_Rewriter round-trip', () => {
  it('should preserve tool-call name and arguments through rewrite', () => {
    fc.assert(
      fc.property(
        toolCallArbitrary,
        (toolCall) => {
          // Format the tool call as it would appear in a response
          const toolCallJson = JSON.stringify({
            id: toolCall.id || `call_${Date.now()}`,
            name: toolCall.name,
            arguments: toolCall.arguments
          });

          // Create a response with the tool-call marker
          const originalResponse = {
            choices: [{
              message: {
                content: `Here is the result: <tool_call>${toolCallJson}</tool_call>`
              }
            }]
          };

          const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');

          // Rewrite the response
          const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
          const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

          // Verify the rewritten response has tool_calls
          expect(rewrittenResponse.choices).to.be.an('array');
          expect(rewrittenResponse.choices[0]).to.have.property('message');
          expect(rewrittenResponse.choices[0].message).to.have.property('tool_calls');

          const toolCalls = rewrittenResponse.choices[0].message.tool_calls;
          expect(toolCalls).to.be.an('array');
          expect(toolCalls.length).to.be.greaterThan(0);

          const rewrittenToolCall = toolCalls[0];

          // Verify name is preserved
          expect(rewrittenToolCall.function.name).to.equal(toolCall.name);

          // Verify arguments are preserved (as string)
          const rewrittenArgs = typeof rewrittenToolCall.function.arguments === 'string'
            ? JSON.parse(rewrittenToolCall.function.arguments)
            : rewrittenToolCall.function.arguments;

          const originalArgs = typeof toolCall.arguments === 'string'
            ? JSON.parse(toolCall.arguments)
            : toolCall.arguments;

          expect(rewrittenArgs).to.deep.equal(originalArgs);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should handle tool-call with function_call marker', () => {
    fc.assert(
      fc.property(
        toolCallArbitrary,
        (toolCall) => {
          const toolCallJson = JSON.stringify({
            id: toolCall.id || `call_${Date.now()}`,
            name: toolCall.name,
            arguments: toolCall.arguments
          });

          // Use function_call marker instead
          const originalResponse = {
            choices: [{
              message: {
                content: `Result: <|function_call|>${toolCallJson}<|/function_call|>`
              }
            }]
          };

          const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
          const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
          const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

          const toolCalls = rewrittenResponse.choices[0].message.tool_calls;
          expect(toolCalls.length).to.be.greaterThan(0);

          const rewrittenToolCall = toolCalls[0];
          expect(rewrittenToolCall.function.name).to.equal(toolCall.name);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should preserve tool-call id when present', () => {
    const toolCall = {
      id: 'call_abc123',
      name: 'get_weather',
      arguments: '{"location": "NYC"}'
    };

    const toolCallJson = JSON.stringify(toolCall);
    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${toolCallJson}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    expect(rewrittenToolCall.id).to.equal('call_abc123');
  });

  it('should generate id when not present', () => {
    const toolCall = {
      name: 'get_weather',
      arguments: '{"location": "NYC"}'
    };

    const toolCallJson = JSON.stringify(toolCall);
    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${toolCallJson}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    expect(rewrittenToolCall.id).to.exist;
    expect(rewrittenToolCall.id).to.be.a('string');
  });

  it('should handle multiple tool calls in sequence', () => {
    const toolCall1 = {
      id: 'call_1',
      name: 'function1',
      arguments: '{"arg": "value1"}'
    };

    const toolCall2 = {
      id: 'call_2',
      name: 'function2',
      arguments: '{"arg": "value2"}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall1)}</tool_call> and <tool_call>${JSON.stringify(toolCall2)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const toolCalls = rewrittenResponse.choices[0].message.tool_calls;
    expect(toolCalls.length).to.equal(2);
    expect(toolCalls[0].function.name).to.equal('function1');
    expect(toolCalls[1].function.name).to.equal('function2');
  });

  it('should handle complex nested arguments', () => {
    const complexArgs = {
      nested: {
        deep: {
          value: 'test'
        }
      },
      array: [1, 2, 3],
      mixed: {
        string: 'value',
        number: 42,
        boolean: true,
        null: null
      }
    };

    const toolCall = {
      id: 'call_complex',
      name: 'complex_function',
      arguments: JSON.stringify(complexArgs)
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    const rewrittenArgs = JSON.parse(rewrittenToolCall.function.arguments);

    expect(rewrittenArgs).to.deep.equal(complexArgs);
  });

  it('should handle tool-call with special characters in name', () => {
    const toolCall = {
      id: 'call_special',
      name: 'get_weather_for_location_v2',
      arguments: '{"location": "NYC"}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    expect(rewrittenToolCall.function.name).to.equal('get_weather_for_location_v2');
  });

  it('should handle tool-call with unicode characters', () => {
    const toolCall = {
      id: 'call_unicode',
      name: 'get_weather',
      arguments: '{"location": "北京"}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    const rewrittenArgs = JSON.parse(rewrittenToolCall.function.arguments);

    expect(rewrittenArgs.location).to.equal('北京');
  });

  it('should preserve tool_calls type as function', () => {
    const toolCall = {
      id: 'call_type_check',
      name: 'test_function',
      arguments: '{}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    expect(rewrittenToolCall.type).to.equal('function');
    expect(rewrittenToolCall.function).to.exist;
    expect(rewrittenToolCall.function.name).to.exist;
    expect(rewrittenToolCall.function.arguments).to.exist;
  });

  it('should handle empty arguments', () => {
    const toolCall = {
      id: 'call_empty',
      name: 'no_args_function',
      arguments: '{}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    const rewrittenArgs = JSON.parse(rewrittenToolCall.function.arguments);

    expect(rewrittenArgs).to.deep.equal({});
  });

  it('should handle tool-call with whitespace in marker', () => {
    const toolCall = {
      id: 'call_whitespace',
      name: 'test_function',
      arguments: '{"key": "value"}'
    };

    const originalResponse = {
      choices: [{
        message: {
          content: `<tool_call>
${JSON.stringify(toolCall)}
</tool_call>`
        }
      }]
    };

    const originalBuffer = Buffer.from(JSON.stringify(originalResponse), 'utf8');
    const rewrittenBuffer = rewriteNonStreaming(originalBuffer);
    const rewrittenResponse = JSON.parse(rewrittenBuffer.toString('utf8'));

    const rewrittenToolCall = rewrittenResponse.choices[0].message.tool_calls[0];
    expect(rewrittenToolCall.function.name).to.equal('test_function');
  });
});
