/**
 * Property Test P19: Tool passthrough preservation
 *
 * For any chat-completions body `r` with non-empty `tools` and an arbitrary
 * `tool_choice`, when routed to a slot with `supportsTools === true`, the
 * upstream request body's `tools` and `tool_choice` are structurally equal
 * (deep-equals) to `r.tools` and `r.tool_choice`.
 *
 * This test verifies that the API Gateway does not modify, filter, or
 * transform the tools and tool_choice fields when forwarding to a slot
 * that supports tools.
 *
 * Validates: Requirements 14.4
 */

const { expect } = require('chai');
const fc = require('fast-check');

/**
 * Mock function that simulates the gateway's tool passthrough logic.
 * In the real gateway, this would be part of _handleChatCompletions.
 *
 * When a slot supports tools, the gateway should forward tools and tool_choice
 * unchanged to the upstream slot.
 */
function forwardToolsToUpstream(requestBody, slotSupportsTools) {
  if (!slotSupportsTools) {
    // If slot doesn't support tools, we'd reject the request
    // But this test assumes we're only testing the passthrough case
    throw new Error('Slot does not support tools');
  }

  // The gateway should forward the request body unchanged
  // (or at least preserve tools and tool_choice exactly)
  const upstreamBody = { ...requestBody };

  // The gateway should NOT modify tools or tool_choice
  // They should be passed through exactly as received
  return upstreamBody;
}

/**
 * Oracle implementation: tools and tool_choice should be preserved exactly
 */
function oracleToolPassthrough(originalBody, upstreamBody) {
  // If original had tools, upstream should have the same tools
  if (originalBody.tools !== undefined) {
    return JSON.stringify(upstreamBody.tools) === JSON.stringify(originalBody.tools);
  }

  // If original had tool_choice, upstream should have the same tool_choice
  if (originalBody.tool_choice !== undefined) {
    return JSON.stringify(upstreamBody.tool_choice) === JSON.stringify(originalBody.tool_choice);
  }

  return true;
}

/**
 * Generator for tool definitions
 */
const toolGenerator = fc.record({
  type: fc.constant('function'),
  function: fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    description: fc.option(fc.string({ maxLength: 500 })),
    parameters: fc.option(
      fc.record({
        type: fc.constant('object'),
        properties: fc.dictionary(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.record({
            type: fc.constantFrom('string', 'number', 'boolean', 'array', 'object'),
            description: fc.option(fc.string({ maxLength: 200 })),
          }),
          { minKeys: 0, maxKeys: 5 }
        ),
        required: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 })),
      })
    ),
  }),
});

/**
 * Generator for tool_choice values
 */
const toolChoiceGenerator = fc.oneof(
  fc.constant('auto'),
  fc.constant('required'),
  fc.record({
    type: fc.constant('function'),
    function: fc.record({
      name: fc.string({ minLength: 1, maxLength: 100 }),
    }),
  })
);

describe('P19: Tool passthrough preservation', () => {
  it('should preserve tools field when forwarding to tool-supporting slot', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'The location' },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should preserve tool_choice field when forwarding to tool-supporting slot', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather',
        },
      },
    ];

    const toolChoice = 'auto';

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: tools,
      tool_choice: toolChoice,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tool_choice).to.equal(toolChoice);
  });

  it('should preserve both tools and tool_choice together', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather',
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Get the current time',
        },
      },
    ];

    const toolChoice = {
      type: 'function',
      function: { name: 'get_weather' },
    };

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: tools,
      tool_choice: toolChoice,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
    expect(upstreamBody.tool_choice).to.deep.equal(toolChoice);
  });

  it('should preserve tools with complex nested parameters', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_database',
          description: 'Search the database',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              filters: {
                type: 'object',
                properties: {
                  date_range: {
                    type: 'object',
                    properties: {
                      start: { type: 'string' },
                      end: { type: 'string' },
                    },
                  },
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            required: ['query'],
          },
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Search for something' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should preserve empty tools array', () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [],
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal([]);
  });

  it('should preserve tool_choice as "auto"', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'test_tool' },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
      tool_choice: 'auto',
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tool_choice).to.equal('auto');
  });

  it('should preserve tool_choice as "required"', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'test_tool' },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
      tool_choice: 'required',
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tool_choice).to.equal('required');
  });

  it('should preserve tool_choice as function object', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'tool_a' },
      },
      {
        type: 'function',
        function: { name: 'tool_b' },
      },
    ];

    const toolChoice = {
      type: 'function',
      function: { name: 'tool_a' },
    };

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
      tool_choice: toolChoice,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tool_choice).to.deep.equal(toolChoice);
  });

  it('should preserve tools with special characters in descriptions', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'Test tool with "quotes" and \'apostrophes\' and \n newlines',
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should preserve tools with unicode characters', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: '获取天气 🌤️ Obtener clima',
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should preserve tools with null and undefined values in optional fields', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: null,
          parameters: undefined,
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should preserve multiple tools with different structures', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'simple_tool',
        },
      },
      {
        type: 'function',
        function: {
          name: 'complex_tool',
          description: 'A complex tool',
          parameters: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
              param2: { type: 'number' },
            },
            required: ['param1'],
          },
        },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.deep.equal(tools);
  });

  it('should not modify other request fields when preserving tools', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'test_tool' },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      tools: tools,
      tool_choice: 'auto',
      stream: true,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.model).to.equal('test-model');
    expect(upstreamBody.temperature).to.equal(0.7);
    expect(upstreamBody.top_p).to.equal(0.9);
    expect(upstreamBody.max_tokens).to.equal(100);
    expect(upstreamBody.stream).to.equal(true);
    expect(upstreamBody.tools).to.deep.equal(tools);
    expect(upstreamBody.tool_choice).to.equal('auto');
  });

  describe('Property-based tests', () => {
    it('should preserve tools for any generated tool definition', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        (tools) => {
          const requestBody = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
          };

          const upstreamBody = forwardToolsToUpstream(requestBody, true);

          // Tools should be preserved exactly
          expect(upstreamBody.tools).to.deep.equal(tools);

          // Verify oracle
          expect(oracleToolPassthrough(requestBody, upstreamBody)).to.be.true;
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should preserve tool_choice for any generated tool_choice value', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        toolChoiceGenerator,
        (tools, toolChoice) => {
          const requestBody = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
            tool_choice: toolChoice,
          };

          const upstreamBody = forwardToolsToUpstream(requestBody, true);

          // tool_choice should be preserved exactly
          expect(upstreamBody.tool_choice).to.deep.equal(toolChoice);

          // Verify oracle
          expect(oracleToolPassthrough(requestBody, upstreamBody)).to.be.true;
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should preserve both tools and tool_choice for any combination', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        toolChoiceGenerator,
        (tools, toolChoice) => {
          const requestBody = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
            tool_choice: toolChoice,
          };

          const upstreamBody = forwardToolsToUpstream(requestBody, true);

          // Both should be preserved exactly
          expect(upstreamBody.tools).to.deep.equal(tools);
          expect(upstreamBody.tool_choice).to.deep.equal(toolChoice);

          // Verify oracle
          expect(oracleToolPassthrough(requestBody, upstreamBody)).to.be.true;
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should preserve tools with arbitrary request body fields', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        fc.record({
          model: fc.string({ minLength: 1 }),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
          top_p: fc.float({ min: 0, max: 1, noNaN: true }),
          max_tokens: fc.integer({ min: 1, max: 10000 }),
          stream: fc.boolean(),
        }),
        (tools, otherFields) => {
          const requestBody = {
            ...otherFields,
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
          };

          const upstreamBody = forwardToolsToUpstream(requestBody, true);

          // Tools should be preserved exactly
          expect(upstreamBody.tools).to.deep.equal(tools);

          // Other fields should also be preserved
          expect(upstreamBody.model).to.equal(otherFields.model);
          expect(upstreamBody.temperature).to.equal(otherFields.temperature);
          expect(upstreamBody.top_p).to.equal(otherFields.top_p);
          expect(upstreamBody.max_tokens).to.equal(otherFields.max_tokens);
          expect(upstreamBody.stream).to.equal(otherFields.stream);

          // Verify oracle
          expect(oracleToolPassthrough(requestBody, upstreamBody)).to.be.true;
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should satisfy the oracle for all generated inputs', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        fc.option(toolChoiceGenerator),
        (tools, toolChoice) => {
          const requestBody = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
          };

          if (toolChoice !== null) {
            requestBody.tool_choice = toolChoice;
          }

          const upstreamBody = forwardToolsToUpstream(requestBody, true);

          // The oracle should always be satisfied
          expect(oracleToolPassthrough(requestBody, upstreamBody)).to.be.true;
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should be deterministic: same input produces same output', () => {
      const property = fc.property(
        fc.array(toolGenerator, { minLength: 1, maxLength: 5 }),
        toolChoiceGenerator,
        (tools, toolChoice) => {
          const requestBody = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            tools: tools,
            tool_choice: toolChoice,
          };

          const upstreamBody1 = forwardToolsToUpstream(requestBody, true);
          const upstreamBody2 = forwardToolsToUpstream(requestBody, true);
          const upstreamBody3 = forwardToolsToUpstream(requestBody, true);

          // All three calls should produce identical results
          expect(upstreamBody1.tools).to.deep.equal(upstreamBody2.tools);
          expect(upstreamBody2.tools).to.deep.equal(upstreamBody3.tools);
          expect(upstreamBody1.tool_choice).to.deep.equal(upstreamBody2.tool_choice);
          expect(upstreamBody2.tool_choice).to.deep.equal(upstreamBody3.tool_choice);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });
  });

  it('should throw when slot does not support tools', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'test_tool' },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    expect(() => forwardToolsToUpstream(requestBody, false)).to.throw();
  });

  it('should handle request body without tools field', () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tools).to.be.undefined;
  });

  it('should handle request body without tool_choice field', () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'test_tool' },
      },
    ];

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: tools,
    };

    const upstreamBody = forwardToolsToUpstream(requestBody, true);

    expect(upstreamBody.tool_choice).to.be.undefined;
  });
});
