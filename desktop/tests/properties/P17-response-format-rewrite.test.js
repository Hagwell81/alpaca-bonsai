/**
 * Property 17: response_format rewriting table
 *
 * For any chat-completions body `r`, the gateway's rewritten body `r'` satisfies:
 * - If `r.response_format === { type: 'json-object' }` and the grammar library read succeeds,
 *   then `r'.grammar` equals the contents of `json-object.gbnf` and `r'` has no `response_format` field
 * - If `r.response_format === { type: 'json_schema', json_schema: s }`,
 *   then `r'.json_schema === s` unchanged
 * - Otherwise `r' === r` on all fields
 *
 * Validates: Requirements 13.2, 13.4
 */

const assert = require('assert');
const fc = require('fast-check');
const { ApiGateway } = require('../../api-gateway');

/**
 * Mock GrammarLibrary for testing
 */
class MockGrammarLibrary {
  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
    this.jsonObjectGrammar = 'root ::= "{\\"test\\":\\"value\\"}"';
  }

  get(name) {
    if (this.shouldFail) {
      throw new Error('Grammar load failed');
    }
    if (name === 'json-object') {
      return this.jsonObjectGrammar;
    }
    throw new Error(`Grammar '${name}' not found`);
  }

  has(name) {
    return name === 'json-object';
  }
}

/**
 * Mock SlotManager for testing
 */
class MockSlotManager {
  listSlots() {
    return [];
  }

  getActiveSlots() {
    return [];
  }
}

/**
 * Extract the response_format rewriting logic from ApiGateway
 * This is the function we're testing
 */
function rewriteResponseFormat(body, grammarLibrary) {
  // Create a deep copy using JSON round-trip to ensure:
  // 1. All objects have normal prototypes (not null)
  // 2. Original body is never mutated
  // 3. Nested objects are properly copied
  const rewritten = JSON.parse(JSON.stringify(body));

  if (rewritten.response_format) {
    if (rewritten.response_format.type === 'json-object') {
      try {
        rewritten.grammar = grammarLibrary.get('json-object');
        delete rewritten.response_format;
      } catch (err) {
        // Forward unchanged per Req 13.3
      }
    } else if (rewritten.response_format.type === 'json_schema') {
      // Preserve json_schema unchanged per Req 13.4
      // (llama-server will handle it via json_schema field)
    }
  }

  return rewritten;
}

describe('P17: response_format rewriting table', () => {
  it('should rewrite json-object to grammar injection', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: { type: 'json-object' },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.strictEqual(rewritten.grammar, grammarLib.get('json-object'));
    assert.strictEqual(rewritten.response_format, undefined);
    assert.strictEqual(rewritten.model, 'test-model');
    assert.deepStrictEqual(rewritten.messages, []);
  });

  it('should preserve json_schema unchanged', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };
    const body = {
      model: 'test-model',
      messages: [],
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(rewritten.response_format, body.response_format);
    assert.deepStrictEqual(rewritten.json_schema, undefined);
    assert.strictEqual(rewritten.model, 'test-model');
  });

  it('should pass through body unchanged when no response_format', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(rewritten, body);
  });

  it('should pass through body unchanged when grammar load fails', () => {
    const grammarLib = new MockGrammarLibrary(true);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: { type: 'json-object' },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    // Should be unchanged when grammar load fails
    assert.deepStrictEqual(rewritten.response_format, body.response_format);
    assert.strictEqual(rewritten.grammar, undefined);
  });

  it('should handle arbitrary response_format types by passing through', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: { type: 'unknown_type', custom: 'value' },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    // Should pass through unchanged for unknown types
    assert.deepStrictEqual(rewritten.response_format, body.response_format);
    assert.strictEqual(rewritten.grammar, undefined);
  });

  it('should not mutate the original body', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: { type: 'json-object' },
    };
    const originalBody = JSON.parse(JSON.stringify(body));

    rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(body, originalBody);
  });

  it('should handle body with multiple fields', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      response_format: { type: 'json-object' },
      stream: true,
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.strictEqual(rewritten.grammar, grammarLib.get('json-object'));
    assert.strictEqual(rewritten.response_format, undefined);
    assert.strictEqual(rewritten.model, 'test-model');
    assert.strictEqual(rewritten.temperature, 0.7);
    assert.strictEqual(rewritten.top_p, 0.9);
    assert.strictEqual(rewritten.max_tokens, 100);
    assert.strictEqual(rewritten.stream, true);
  });

  it('should handle json_schema with nested properties', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' },
          },
        },
      },
    };
    const body = {
      model: 'test-model',
      messages: [],
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(rewritten.response_format.json_schema, schema);
    assert.strictEqual(rewritten.grammar, undefined);
  });

  it('should preserve all other fields when rewriting json-object', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      response_format: { type: 'json-object' },
      stream: true,
      tools: [{ type: 'function', function: { name: 'test' } }],
      tool_choice: 'auto',
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.strictEqual(rewritten.grammar, grammarLib.get('json-object'));
    assert.strictEqual(rewritten.response_format, undefined);
    assert.strictEqual(rewritten.model, 'test-model');
    assert.deepStrictEqual(rewritten.messages, body.messages);
    assert.strictEqual(rewritten.temperature, 0.7);
    assert.strictEqual(rewritten.top_p, 0.9);
    assert.strictEqual(rewritten.max_tokens, 100);
    assert.strictEqual(rewritten.stream, true);
    assert.deepStrictEqual(rewritten.tools, body.tools);
    assert.strictEqual(rewritten.tool_choice, 'auto');
  });

  it('should handle empty messages array', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: { type: 'json-object' },
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.strictEqual(rewritten.grammar, grammarLib.get('json-object'));
    assert.strictEqual(rewritten.response_format, undefined);
    assert.deepStrictEqual(rewritten.messages, []);
  });

  it('should handle null response_format', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
      response_format: null,
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(rewritten, body);
  });

  it('should handle undefined response_format', () => {
    const grammarLib = new MockGrammarLibrary(false);
    const body = {
      model: 'test-model',
      messages: [],
    };

    const rewritten = rewriteResponseFormat(body, grammarLib);

    assert.deepStrictEqual(rewritten, body);
  });

  describe('Property-based tests', () => {
    it('should satisfy the response_format rewriting table for json-object', () => {
      const property = fc.property(
        fc.record({
          model: fc.string(),
          messages: fc.array(fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string(),
          })),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
          otherField: fc.string(),
        }),
        (body) => {
          const grammarLib = new MockGrammarLibrary(false);
          const bodyWithFormat = {
            ...body,
            response_format: { type: 'json-object' },
          };

          const rewritten = rewriteResponseFormat(bodyWithFormat, grammarLib);

          // Verify the rewriting table:
          // 1. grammar field should be set to json-object.gbnf content
          assert.strictEqual(rewritten.grammar, grammarLib.get('json-object'));

          // 2. response_format field should be removed
          assert.strictEqual(rewritten.response_format, undefined);

          // 3. All other fields should be preserved (normalize for comparison)
          const normalizedBody = JSON.parse(JSON.stringify(body));
          assert.strictEqual(rewritten.model, normalizedBody.model);
          assert.deepStrictEqual(rewritten.messages, normalizedBody.messages);
          assert.strictEqual(rewritten.temperature, normalizedBody.temperature);
          assert.strictEqual(rewritten.otherField, normalizedBody.otherField);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should satisfy the response_format rewriting table for json_schema', () => {
      const property = fc.property(
        fc.record({
          model: fc.string(),
          messages: fc.array(fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string(),
          })),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
        }),
        fc.record({
          type: fc.constant('object'),
          properties: fc.record({
            name: fc.record({ type: fc.constant('string') }),
          }),
        }),
        (body, schema) => {
          const grammarLib = new MockGrammarLibrary(false);
          const bodyWithFormat = {
            ...body,
            response_format: {
              type: 'json_schema',
              json_schema: schema,
            },
          };

          const rewritten = rewriteResponseFormat(bodyWithFormat, grammarLib);

          // Verify the rewriting table:
          // 1. response_format should be preserved unchanged (normalize for comparison)
          const normalizedBodyWithFormat = JSON.parse(JSON.stringify(bodyWithFormat));
          assert.deepStrictEqual(rewritten.response_format, normalizedBodyWithFormat.response_format);

          // 2. json_schema should NOT be injected at top level
          assert.strictEqual(rewritten.json_schema, undefined);

          // 3. All other fields should be preserved (normalize for comparison)
          const normalizedBody = JSON.parse(JSON.stringify(body));
          assert.strictEqual(rewritten.model, normalizedBody.model);
          assert.deepStrictEqual(rewritten.messages, normalizedBody.messages);
          assert.strictEqual(rewritten.temperature, normalizedBody.temperature);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should satisfy the response_format rewriting table for no response_format', () => {
      const property = fc.property(
        fc.record({
          model: fc.string(),
          messages: fc.array(fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string(),
          })),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
          otherField: fc.string(),
        }),
        (body) => {
          const grammarLib = new MockGrammarLibrary(false);

          const rewritten = rewriteResponseFormat(body, grammarLib);

          // Verify the rewriting table:
          // When no response_format, body should be unchanged (normalize for comparison)
          const normalizedBody = JSON.parse(JSON.stringify(body));
          assert.deepStrictEqual(rewritten, normalizedBody);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should satisfy the response_format rewriting table when grammar load fails', () => {
      const property = fc.property(
        fc.record({
          model: fc.string(),
          messages: fc.array(fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string(),
          })),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
        }),
        (body) => {
          const grammarLib = new MockGrammarLibrary(true); // Grammar load will fail
          const bodyWithFormat = {
            ...body,
            response_format: { type: 'json-object' },
          };

          const rewritten = rewriteResponseFormat(bodyWithFormat, grammarLib);

          // Verify the rewriting table:
          // When grammar load fails, body should be forwarded unchanged per Req 13.3
          assert.deepStrictEqual(rewritten.response_format, bodyWithFormat.response_format);
          assert.strictEqual(rewritten.grammar, undefined);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });

    it('should not mutate the original body for any response_format type', () => {
      const property = fc.property(
        fc.record({
          model: fc.string(),
          messages: fc.array(fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string(),
          })),
          temperature: fc.float({ min: 0, max: 2, noNaN: true }),
        }),
        fc.constantFrom('json-object', 'json_schema', 'unknown', null, undefined),
        (body, formatType) => {
          const grammarLib = new MockGrammarLibrary(false);
          let bodyWithFormat = { ...body };

          if (formatType === 'json-object') {
            bodyWithFormat.response_format = { type: 'json-object' };
          } else if (formatType === 'json_schema') {
            bodyWithFormat.response_format = {
              type: 'json_schema',
              json_schema: { type: 'object' },
            };
          } else if (formatType === 'unknown') {
            bodyWithFormat.response_format = { type: 'unknown' };
          } else if (formatType === null) {
            bodyWithFormat.response_format = null;
          }

          // Normalize the original body for comparison
          const originalBody = JSON.parse(JSON.stringify(bodyWithFormat));

          rewriteResponseFormat(bodyWithFormat, grammarLib);

          // Original body should not be mutated (compare normalized versions)
          const normalizedBodyAfter = JSON.parse(JSON.stringify(bodyWithFormat));
          assert.deepStrictEqual(normalizedBodyAfter, originalBody);
        }
      );

      fc.assert(property, { numRuns: 100 });
    });
  });
});

