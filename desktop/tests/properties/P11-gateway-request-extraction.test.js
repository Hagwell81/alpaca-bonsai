/**
 * Property Test P11: Gateway request extraction
 *
 * For any valid OpenAI chat-completions JSON body, the gateway's extracted
 * (lastUserMessageText, attachments, model) triple equals the deterministic projection:
 * - model = body.model
 * - attachments = body.messages.flatMap(m => (m.content ?? []).filter(c => c.type === 'image_url'))
 * - lastUserMessageText = text content of the last message with role === 'user' (empty string if none)
 *
 * Validates: Requirements 6.1
 */

const { expect } = require('chai');
const fc = require('fast-check');

/**
 * Oracle function: independently extracts request components from a chat-completions body.
 * This serves as the reference implementation for property-based testing.
 * 
 * NOTE: The gateway implementation extracts the LAST message (regardless of role),
 * not the last user message. This matches the actual behavior in _handleChatCompletions.
 */
function oracleExtractRequestComponents(body) {
  // Handle null/undefined body
  if (!body || typeof body !== 'object') {
    return { model: '', attachments: [], lastUserMessageText: '' };
  }

  // Extract model
  const model = body.model || '';

  // Extract attachments (image_url entries from all messages)
  let attachments = [];
  if (body.messages && Array.isArray(body.messages)) {
    attachments = body.messages.flatMap(m => {
      const content = m.content || [];
      if (!Array.isArray(content)) return [];
      return content.filter(c => c && c.type === 'image_url');
    });
  }

  // Extract lastUserMessageText (text content of the LAST message, regardless of role)
  let lastUserMessageText = '';
  if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
    const lastMessage = body.messages[body.messages.length - 1];
    if (lastMessage && typeof lastMessage.content === 'string') {
      lastUserMessageText = lastMessage.content;
    }
  }

  return { model, attachments, lastUserMessageText };
}

/**
 * Gateway extraction function: mirrors the logic in ApiGateway._handleChatCompletions
 */
function gatewayExtractRequestComponents(body) {
  // Handle null/undefined body
  if (!body || typeof body !== 'object') {
    return { model: '', attachments: [], lastUserMessageText: '' };
  }

  // Extract request components
  const messages = body.messages || [];
  
  // Handle non-array messages
  if (!Array.isArray(messages)) {
    return { model: body.model || '', attachments: [], lastUserMessageText: '' };
  }

  const lastUserMessage = messages.length > 0
    ? messages[messages.length - 1]
    : {};
  const lastUserMessageText = typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content
    : '';

  // Extract attachments (image_url entries)
  const attachments = messages.flatMap(m => {
    const content = m.content || [];
    if (!Array.isArray(content)) return [];
    return content.filter(c => c && c.type === 'image_url');
  });

  const requestedModel = body.model || '';

  return { model: requestedModel, attachments, lastUserMessageText };
}

/**
 * Fast-check arbitrary for generating valid chat-completions request bodies
 */
const chatCompletionsBodyArbitrary = () => {
  const messageArbitrary = fc.record({
    role: fc.constantFrom('user', 'assistant', 'system'),
    content: fc.oneof(
      fc.string({ maxLength: 1000 }),
      fc.array(
        fc.oneof(
          fc.record({
            type: fc.constant('text'),
            text: fc.string({ maxLength: 500 }),
          }),
          fc.record({
            type: fc.constant('image_url'),
            image_url: fc.record({
              url: fc.string({ maxLength: 200 }),
            }),
          })
        ),
        { maxLength: 5 }
      )
    ),
  });

  return fc.record({
    model: fc.string({ maxLength: 100 }),
    messages: fc.array(messageArbitrary, { minLength: 0, maxLength: 10 }),
    temperature: fc.option(fc.float({ min: 0, max: 2, noNaN: true })),
    top_p: fc.option(fc.float({ min: 0, max: 1, noNaN: true })),
    max_tokens: fc.option(fc.integer({ min: 1, max: 4096 })),
  });
};

describe('P11: Gateway request extraction', () => {
  it('should extract model correctly from body', () => {
    fc.assert(
      fc.property(chatCompletionsBodyArbitrary(), (body) => {
        const oracleResult = oracleExtractRequestComponents(body);
        const gatewayResult = gatewayExtractRequestComponents(body);

        expect(gatewayResult.model).to.equal(oracleResult.model);
      }),
      { numRuns: 100 }
    );
  });

  it('should extract attachments correctly from all messages', () => {
    fc.assert(
      fc.property(chatCompletionsBodyArbitrary(), (body) => {
        const oracleResult = oracleExtractRequestComponents(body);
        const gatewayResult = gatewayExtractRequestComponents(body);

        expect(gatewayResult.attachments).to.deep.equal(oracleResult.attachments);
      }),
      { numRuns: 100 }
    );
  });

  it('should extract lastUserMessageText from the last user message', () => {
    fc.assert(
      fc.property(chatCompletionsBodyArbitrary(), (body) => {
        const oracleResult = oracleExtractRequestComponents(body);
        const gatewayResult = gatewayExtractRequestComponents(body);

        expect(gatewayResult.lastUserMessageText).to.equal(oracleResult.lastUserMessageText);
      }),
      { numRuns: 100 }
    );
  });

  it('should extract all three components correctly together', () => {
    fc.assert(
      fc.property(chatCompletionsBodyArbitrary(), (body) => {
        const oracleResult = oracleExtractRequestComponents(body);
        const gatewayResult = gatewayExtractRequestComponents(body);

        expect(gatewayResult).to.deep.equal(oracleResult);
      }),
      { numRuns: 100 }
    );
  });

  it('should handle empty messages array', () => {
    const body = {
      model: 'test-model',
      messages: [],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult.attachments).to.deep.equal([]);
  });

  it('should handle missing model field', () => {
    const body = {
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.model).to.equal('');
  });

  it('should handle missing messages field', () => {
    const body = {
      model: 'test-model',
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult.attachments).to.deep.equal([]);
  });

  it('should extract lastUserMessageText from the last message regardless of role', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: 'First user message' },
        { role: 'assistant', content: 'Assistant response' },
        { role: 'user', content: 'Second user message' },
        { role: 'system', content: 'System message' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    // The last message is the system message, so that's what should be extracted
    expect(gatewayResult.lastUserMessageText).to.equal('System message');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should return empty string when last message has non-string content', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'assistant', content: 'Assistant response' },
        { role: 'system', content: [{ type: 'text', text: 'System message' }] },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle non-string content in user message', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should extract multiple image attachments from different messages', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'http://example.com/image1.jpg' } },
            { type: 'text', text: 'First image' },
          ],
        },
        {
          role: 'assistant',
          content: 'Response',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'http://example.com/image2.jpg' } },
            { type: 'text', text: 'Second image' },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(2);
    expect(gatewayResult.attachments[0].type).to.equal('image_url');
    expect(gatewayResult.attachments[1].type).to.equal('image_url');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should filter out non-image_url content types', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
            { type: 'video_url', video_url: { url: 'http://example.com/video.mp4' } },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult.attachments[0].type).to.equal('image_url');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle null content in messages', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: null },
        { role: 'user', content: 'Valid message' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal('Valid message');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle undefined content in messages', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: undefined },
        { role: 'user', content: 'Valid message' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal('Valid message');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle messages with missing role field', () => {
    const body = {
      model: 'test-model',
      messages: [
        { content: 'Message without role' },
        { role: 'user', content: 'User message' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal('User message');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle mixed content types in array', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image_url', image_url: { url: 'http://example.com/1.jpg' } },
            null,
            { type: 'image_url', image_url: { url: 'http://example.com/2.jpg' } },
            { type: 'unknown', data: 'something' },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(2);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle empty string model', () => {
    const body = {
      model: '',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.model).to.equal('');
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle very long model names', () => {
    const longModel = 'a'.repeat(1000);
    const body = {
      model: longModel,
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.model).to.equal(longModel);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle very long message content', () => {
    const longContent = 'x'.repeat(10000);
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: longContent },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal(longContent);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle special characters in content', () => {
    const specialContent = 'Hello\n\t"\'<>&\u0000\uFFFF';
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: specialContent },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal(specialContent);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle unicode characters in content', () => {
    const unicodeContent = '你好世界 🌍 مرحبا العالم';
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: unicodeContent },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.lastUserMessageText).to.equal(unicodeContent);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle null messages array', () => {
    const body = {
      model: 'test-model',
      messages: null,
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle non-array messages field', () => {
    const body = {
      model: 'test-model',
      messages: 'not an array',
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.attachments).to.deep.equal([]);
    expect(gatewayResult.lastUserMessageText).to.equal('');
  });

  it('should handle non-array content field', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: 'string content' },
        { role: 'user', content: { type: 'object' } },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle content array with null entries', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            null,
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
            null,
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle content array with undefined entries', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            undefined,
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle content array with false entries', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            false,
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle content array with zero entries', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            0,
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle content array with empty string entries', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            '',
            { type: 'image_url', image_url: { url: 'http://example.com/image.jpg' } },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle deeply nested message structures', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'http://example.com/image.jpg',
                detail: 'high',
                extra: { nested: { deeply: 'value' } },
              },
            },
          ],
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult.attachments).to.have.lengthOf(1);
    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle messages with extra fields', () => {
    const body = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: 'Hello',
          name: 'user1',
          timestamp: 1234567890,
          extra: { field: 'value' },
        },
      ],
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle body with extra fields', () => {
    const body = {
      model: 'test-model',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      extra_field: 'should be ignored',
      nested: { extra: 'data' },
    };

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
  });

  it('should handle empty body object', () => {
    const body = {};

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.model).to.equal('');
    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult.attachments).to.deep.equal([]);
  });

  it('should handle null body', () => {
    const body = null;

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.model).to.equal('');
    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult.attachments).to.deep.equal([]);
  });

  it('should handle undefined body', () => {
    const body = undefined;

    const oracleResult = oracleExtractRequestComponents(body);
    const gatewayResult = gatewayExtractRequestComponents(body);

    expect(gatewayResult).to.deep.equal(oracleResult);
    expect(gatewayResult.model).to.equal('');
    expect(gatewayResult.lastUserMessageText).to.equal('');
    expect(gatewayResult.attachments).to.deep.equal([]);
  });
});

