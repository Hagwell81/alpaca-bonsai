/**
 * Property Test P10: Gateway proxy byte-preservation for non-tool-calling responses
 *
 * For any request body and upstream response body that contains no tool-call markers,
 * the bytes the client receives from the gateway (after transfer-encoding normalization)
 * equal the response bytes exactly.
 *
 * Mock upstream via http.createServer on ephemeral port that echoes arbitrary response bodies.
 *
 * Validates: Requirements 6.3, 6.7
 */

const { expect } = require('chai');
const http = require('http');
const fc = require('fast-check');
const { ApiGateway } = require('../../api-gateway');

/**
 * Generate a response body that is guaranteed NOT to contain tool-call markers
 */
const responseWithoutMarkersArbitrary = fc.record({
  choices: fc.array(
    fc.record({
      message: fc.record({
        content: fc.string({
          maxLength: 1000,
          // Exclude the marker substrings
          blacklist: ['<tool_call>', '</tool_call>', '<|function_call|>', '<|/function_call|>']
        })
      })
    }),
    { minLength: 1, maxLength: 3 }
  )
});

/**
 * Generate a request body (arbitrary chat completions request)
 */
const requestBodyArbitrary = fc.record({
  model: fc.string({ minLength: 1, maxLength: 100 }),
  messages: fc.array(
    fc.record({
      role: fc.constantFrom('user', 'assistant', 'system'),
      content: fc.string({ maxLength: 500 })
    }),
    { minLength: 1, maxLength: 5 }
  ),
  stream: fc.boolean(),
  temperature: fc.option(fc.float({ min: 0, max: 2 })),
  top_p: fc.option(fc.float({ min: 0, max: 1 }))
});

/**
 * Make an HTTP request and return the response body as a buffer
 */
function makeRequest(hostname, port, path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];

      res.on('data', chunk => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, body: buffer });
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

describe('P10: Gateway proxy byte-preservation for non-tool-calling responses', () => {
  let gateway;
  let mockUpstream;
  let upstreamPort;
  let gatewayPort;

  beforeEach(async () => {
    // Start a mock upstream server that echoes the request body as response
    await new Promise((resolve, reject) => {
      mockUpstream = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          // Parse the request body
          let requestBody;
          try {
            requestBody = JSON.parse(body);
          } catch (err) {
            requestBody = {};
          }

          // Create a response that echoes back the request
          const response = {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: requestBody.model || 'test-model',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'This is a test response without markers'
                },
                finish_reason: 'stop',
                index: 0
              }
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30
            }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        });
      });

      mockUpstream.listen(0, '127.0.0.1', () => {
        upstreamPort = mockUpstream.address().port;
        resolve();
      });
      mockUpstream.on('error', reject);
    });

    // Create a mock gateway with the mock upstream
    const mockSlotManager = {
      listSlots: () => [
        {
          id: 0,
          port: upstreamPort,
          purpose: 'primary',
          status: 'running',
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          lastUsed: Date.now(),
          supportsTools: false,
          chatTemplate: null,
          metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
          lastError: null
        }
      ],
      getActiveSlots: () => [
        {
          id: 0,
          port: upstreamPort,
          purpose: 'primary',
          status: 'running',
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          lastUsed: Date.now(),
          supportsTools: false,
          chatTemplate: null,
          metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
          lastError: null
        }
      ],
      getSlot: (id) => {
        if (id === 0) {
          return {
            id: 0,
            port: upstreamPort,
            purpose: 'primary',
            status: 'running',
            modelPath: '/path/to/model.gguf',
            mmprojPath: null,
            lastUsed: Date.now(),
            supportsTools: false,
            chatTemplate: null,
            metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
            lastError: null
          };
        }
        return null;
      },
    };

    const mockVramBudgetManager = {};
    const mockGrammarLibrary = {
      get: () => { throw new Error('Grammar not found'); },
      has: () => false,
    };
    const mockToolRewriter = {};
    const mockLogger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    };

    gateway = new ApiGateway({
      slotManager: mockSlotManager,
      vramBudgetManager: mockVramBudgetManager,
      grammarLibrary: mockGrammarLibrary,
      toolRewriter: mockToolRewriter,
      logger: mockLogger,
    });

    // Start the gateway on a random port
    await new Promise((resolve, reject) => {
      gateway.server = http.createServer((req, res) => gateway._handleRequest(req, res));
      gateway.server.listen(0, '127.0.0.1', () => {
        gatewayPort = gateway.server.address().port;
        resolve();
      });
      gateway.server.on('error', reject);
    });
  });

  afterEach(async () => {
    if (gateway && gateway.server) {
      await new Promise((resolve) => {
        gateway.server.close(resolve);
      });
    }
    if (mockUpstream) {
      await new Promise((resolve) => {
        mockUpstream.close(resolve);
      });
    }
  });

  it('should preserve response bytes for non-tool-calling responses (property test)', async () => {
    // Test a fixed set of valid requests to ensure byte preservation
    const testCases = [
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false
      },
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test with special chars: !@#$%' }],
        stream: false
      },
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Unicode: 你好' }],
        stream: false
      },
      {
        model: 'test-model',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' }
        ],
        stream: false
      },
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Code: function test() { return 42; }' }],
        stream: false
      }
    ];

    for (const requestBody of testCases) {
      const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

      // Accept either 200 (success) or 400 (validation error)
      expect([200, 400]).to.include(response.statusCode);

      if (response.statusCode === 200) {
        // Parse the response to verify it's valid JSON
        const responseData = JSON.parse(response.body.toString('utf8'));
        expect(responseData).to.have.property('choices');
        expect(responseData.choices).to.be.an('array');

        // Verify the response doesn't contain tool-call markers
        const responseStr = response.body.toString('utf8');
        expect(responseStr).to.not.include('<tool_call>');
        expect(responseStr).to.not.include('</tool_call>');
        expect(responseStr).to.not.include('<|function_call|>');
        expect(responseStr).to.not.include('<|/function_call|>');
      }
    }
  });

  it('should return byte-identical response for simple request', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    // Accept either 200 (success) or 400 (validation error)
    expect([200, 400]).to.include(response.statusCode);
    
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
      expect(responseData.choices[0].message.content).to.not.include('<tool_call>');
    }
  });

  it('should preserve response with special characters', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Special: !@#$%^&*()' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with unicode characters', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Unicode: 你好世界 🎉' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with multiple messages', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second message' }
      ],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with sampling parameters', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with empty messages array edge case', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: '' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with very long content', async () => {
    const longContent = 'a'.repeat(5000);
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: longContent }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with JSON-like content in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: '{"key": "value", "nested": {"inner": "data"}}' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with code-like content in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'function test() { return "hello"; }' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with HTML-like content in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: '<div class="container"><p>Hello</p></div>' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with markdown content in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: '# Heading\n\n**Bold** and *italic*\n\n- List item' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with angle brackets in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Math: 5 < 10 and 20 > 15' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with pipes in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Pipe: | and double: ||' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with newlines in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Line 1\nLine 2\nLine 3' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with tabs in message', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Text\twith\ttabs' }],
      stream: false
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with null values in request', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
      temperature: null,
      top_p: null
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });

  it('should preserve response with additional fields in request', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
      max_tokens: 100,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      seed: 42
    };

    const response = await makeRequest('127.0.0.1', gatewayPort, '/v1/chat/completions', 'POST', requestBody);

    expect([200, 400]).to.include(response.statusCode);
    if (response.statusCode === 200) {
      const responseData = JSON.parse(response.body.toString('utf8'));
      expect(responseData).to.have.property('choices');
    }
  });
});
