/**
 * @fileoverview Unit tests for api-compat.js
 *
 * Tests the Anthropic Messages API and Ollama-native API conversion
 * utilities and the ApiCompat handler class.
 */

const { expect } = require('chai');
const http = require('http');
const { EventEmitter } = require('events');

const {
  ApiCompat,
  ALPACA_VERSION,
  anthropicToOpenAI,
  openAIToAnthropic,
  ollamaChatToOpenAI,
  openAIToOllamaChat,
  ollamaGenerateToOpenAI,
  openAIToOllamaGenerate,
  openAIModelToOllama,
} = require('../api-compat');

// ---------------------------------------------------------------------------
// Helper: create a mock req object with a JSON body
// ---------------------------------------------------------------------------
function mockReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/';
  req.headers = { 'content-type': 'application/json' };
  // Emit body on next tick so listeners can attach
  process.nextTick(() => {
    if (body != null) {
      req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
    }
    req.emit('end');
  });
  return req;
}

// Helper: create a mock res object that captures writes
function mockRes() {
  const res = new EventEmitter();
  res.writeHead = function (statusCode, headers) {
    this._statusCode = statusCode;
    this._headers = headers || {};
  };
  res.setHeader = function (k, v) { this._headers = this._headers || {}; this._headers[k] = v; };
  res.write = function (chunk) { this._chunks = (this._chunks || []) + (Buffer.isBuffer(chunk) ? chunk.toString() : chunk); };
  res.end = function (chunk) {
    if (chunk) this._chunks = (this._chunks || '') + (Buffer.isBuffer(chunk) ? chunk.toString() : chunk);
    this._ended = true;
    this.emit('end');
  };
  return res;
}

// Helper: start a tiny upstream server that returns a fixed JSON body
function startUpstream(port, handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        handler(req, res, data);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Conversion utility tests
// ---------------------------------------------------------------------------

describe('api-compat — conversion utilities', () => {

  describe('anthropicToOpenAI', () => {
    it('converts a simple user message', () => {
      const result = anthropicToOpenAI({
        model: 'bonsai-27b',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      });
      expect(result.model).to.equal('bonsai-27b');
      expect(result.messages).to.deep.equal([{ role: 'user', content: 'Hello' }]);
      expect(result.max_tokens).to.equal(1024);
      expect(result.stream).to.equal(false);
    });

    it('lifts the top-level system field into a system message', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      });
      expect(result.messages[0]).to.deep.equal({ role: 'system', content: 'You are helpful.' });
      expect(result.messages[1]).to.deep.equal({ role: 'user', content: 'Hi' });
    });

    it('converts array system blocks', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        system: [{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }],
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      });
      expect(result.messages[0]).to.deep.equal({ role: 'system', content: 'Part 1\nPart 2' });
    });

    it('converts image content blocks to OpenAI image_url', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        }],
        max_tokens: 100,
      });
      const userMsg = result.messages[0];
      expect(userMsg.role).to.equal('user');
      expect(Array.isArray(userMsg.content)).to.equal(true);
      expect(userMsg.content[0]).to.deep.equal({ type: 'text', text: 'What is this?' });
      expect(userMsg.content[1].type).to.equal('image_url');
      expect(userMsg.content[1].image_url.url).to.equal('data:image/png;base64,abc123');
    });

    it('converts Anthropic tools to OpenAI tools', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        tools: [{
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        }],
      });
      expect(result.tools).to.have.length(1);
      expect(result.tools[0].type).to.equal('function');
      expect(result.tools[0].function.name).to.equal('get_weather');
      expect(result.tools[0].function.parameters.properties.city).to.exist;
    });

    it('converts thinking.enabled to reasoning_format=auto', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        thinking: { type: 'enabled' },
      });
      expect(result.reasoning_format).to.equal('auto');
    });

    it('maps stop_sequences to stop', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stop_sequences: ['END', 'STOP'],
      });
      expect(result.stop).to.deep.equal(['END', 'STOP']);
    });

    it('converts tool_use and tool_result blocks', () => {
      const result = anthropicToOpenAI({
        model: 'm',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'SF' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Sunny, 72F' }],
          },
        ],
      });
      // assistant message should have tool_calls
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      expect(assistantMsg.tool_calls).to.have.length(1);
      expect(assistantMsg.tool_calls[0].id).to.equal('toolu_1');
      expect(assistantMsg.tool_calls[0].function.name).to.equal('get_weather');
      expect(JSON.parse(assistantMsg.tool_calls[0].function.arguments)).to.deep.equal({ city: 'SF' });
      // tool result should become a tool message
      const toolMsg = result.messages.find(m => m.role === 'tool');
      expect(toolMsg.tool_call_id).to.equal('toolu_1');
      expect(toolMsg.content).to.equal('Sunny, 72F');
    });
  });

  describe('openAIToAnthropic', () => {
    it('converts a simple text response', () => {
      const result = openAIToAnthropic({
        model: 'bonsai-27b',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello!' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }, 'bonsai-27b');
      expect(result.type).to.equal('message');
      expect(result.role).to.equal('assistant');
      expect(result.content[0].type).to.equal('text');
      expect(result.content[0].text).to.equal('Hello!');
      expect(result.stop_reason).to.equal('end_turn');
      expect(result.usage.input_tokens).to.equal(5);
      expect(result.usage.output_tokens).to.equal(3);
    });

    it('maps finish_reason to stop_reason', () => {
      const lengthResp = openAIToAnthropic({
        choices: [{ finish_reason: 'length', message: { content: '...' } }],
      }, 'm');
      expect(lengthResp.stop_reason).to.equal('max_tokens');

      const toolResp = openAIToAnthropic({
        choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'tc1', function: { name: 'foo', arguments: '{"a":1}' } }] } }],
      }, 'm');
      expect(toolResp.stop_reason).to.equal('tool_use');
      expect(toolResp.content.find(c => c.type === 'tool_use')).to.exist;
      expect(toolResp.content.find(c => c.type === 'tool_use').input).to.deep.equal({ a: 1 });
    });

    it('preserves reasoning_content as a thinking block', () => {
      const result = openAIToAnthropic({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Answer', reasoning_content: 'Let me think...' } }],
      }, 'm');
      expect(result.content[0].type).to.equal('thinking');
      expect(result.content[0].thinking).to.equal('Let me think...');
      expect(result.content[1].type).to.equal('text');
      expect(result.content[1].text).to.equal('Answer');
    });
  });

  describe('ollamaChatToOpenAI', () => {
    it('converts a simple chat request', () => {
      const result = ollamaChatToOpenAI({
        model: 'bonsai-27b',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.model).to.equal('bonsai-27b');
      expect(result.messages).to.deep.equal([{ role: 'user', content: 'Hello' }]);
      expect(result.stream).to.equal(true); // Ollama defaults to streaming
    });

    it('lifts the system field', () => {
      const result = ollamaChatToOpenAI({
        model: 'm',
        system: 'Be concise.',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      });
      expect(result.messages[0]).to.deep.equal({ role: 'system', content: 'Be concise.' });
      expect(result.stream).to.equal(false);
    });

    it('maps options to OpenAI params', () => {
      const result = ollamaChatToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        options: { temperature: 0.5, top_p: 0.9, seed: 42, num_predict: 100 },
      });
      expect(result.temperature).to.equal(0.5);
      expect(result.top_p).to.equal(0.9);
      expect(result.seed).to.equal(42);
      expect(result.max_tokens).to.equal(100);
    });

    it('maps format=json to response_format', () => {
      const result = ollamaChatToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        format: 'json',
      });
      expect(result.response_format).to.deep.equal({ type: 'json_object' });
    });

    it('maps format=<schema> to json_schema', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } };
      const result = ollamaChatToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        format: schema,
      });
      expect(result.response_format.type).to.equal('json_schema');
      expect(result.response_format.json_schema).to.equal(schema);
    });

    it('converts Ollama tools to OpenAI tools', () => {
      const result = ollamaChatToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        }],
      });
      expect(result.tools).to.have.length(1);
      expect(result.tools[0].function.name).to.equal('get_weather');
    });

    it('maps think=true to reasoning_format=auto', () => {
      const result = ollamaChatToOpenAI({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
        think: true,
      });
      expect(result.reasoning_format).to.equal('auto');
    });
  });

  describe('openAIToOllamaChat', () => {
    it('converts a simple response', () => {
      const result = openAIToOllamaChat({
        model: 'bonsai-27b',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello!' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });
      expect(result.model).to.equal('bonsai-27b');
      expect(result.message.role).to.equal('assistant');
      expect(result.message.content).to.equal('Hello!');
      expect(result.done).to.equal(true);
      expect(result.done_reason).to.equal('stop');
      expect(result.prompt_eval_count).to.equal(5);
      expect(result.eval_count).to.equal(3);
    });
  });

  describe('ollamaGenerateToOpenAI', () => {
    it('converts a generate request to chat completions', () => {
      const result = ollamaGenerateToOpenAI({
        model: 'bonsai-27b',
        prompt: 'Why is the sky blue?',
        stream: false,
      });
      expect(result.model).to.equal('bonsai-27b');
      expect(result.messages[0].role).to.equal('user');
      expect(result.messages[0].content).to.equal('Why is the sky blue?');
      expect(result.stream).to.equal(false);
    });

    it('lifts the system field', () => {
      const result = ollamaGenerateToOpenAI({
        model: 'm',
        prompt: 'Hi',
        system: 'Be brief.',
      });
      expect(result.messages[0]).to.deep.equal({ role: 'system', content: 'Be brief.' });
    });
  });

  describe('openAIToOllamaGenerate', () => {
    it('converts to the generate response shape', () => {
      const result = openAIToOllamaGenerate({
        model: 'bonsai-27b',
        choices: [{ finish_reason: 'stop', message: { content: 'Because of Rayleigh scattering.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      });
      expect(result.model).to.equal('bonsai-27b');
      expect(result.response).to.equal('Because of Rayleigh scattering.');
      expect(result.done).to.equal(true);
      expect(result.eval_count).to.equal(10);
    });
  });

  describe('openAIModelToOllama', () => {
    it('converts a model entry', () => {
      const result = openAIModelToOllama({ id: 'bonsai-27b', owned_by: 'bonsai' });
      expect(result.name).to.equal('bonsai-27b');
      expect(result.model).to.equal('bonsai-27b');
      expect(result.details.format).to.equal('gguf');
      expect(result.details.family).to.equal('bonsai');
      expect(result.digest).to.match(/^sha256:/);
    });
  });
});

// ---------------------------------------------------------------------------
// Handler tests (with a mock upstream server)
// ---------------------------------------------------------------------------

describe('api-compat — ApiCompat handlers', () => {
  let upstream;
  let upstreamPort = 13599;
  let compat;

  before(async () => {
    // Start a mock upstream that pretends to be the gateway's /v1/* endpoints
    upstream = await startUpstream(upstreamPort, (req, res, bodyStr) => {
      const url = req.url;
      if (url === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          data: [{ id: 'bonsai-27b', object: 'model', owned_by: 'bonsai' }],
        }));
        return;
      }
      if (url === '/v1/chat/completions' && req.method === 'POST') {
        let body;
        try { body = JSON.parse(bodyStr); } catch (_) { body = {}; }
        if (body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n');
          res.write('data: {"choices":[{"finish_reason":"stop","delta":{}}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-1',
            model: body.model || 'bonsai-27b',
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello world' } }],
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          }));
        }
        return;
      }
      if (url === '/v1/embeddings' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: 'bonsai-27b',
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 3 },
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    compat = new ApiCompat({ gatewayPort: upstreamPort, logger: { log: () => {}, warn: () => {}, error: () => {} } });
  });

  after(async () => {
    await stopServer(upstream);
  });

  it('GET /api/version returns the version', async () => {
    const req = new EventEmitter(); req.method = 'GET'; req.url = '/api/version'; req.headers = {};
    const res = mockRes();
    await compat.handleVersion(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.version).to.equal(ALPACA_VERSION);
  });

  it('GET /api/tags returns models in Ollama format', async () => {
    const req = new EventEmitter(); req.method = 'GET'; req.url = '/api/tags'; req.headers = {};
    const res = mockRes();
    await compat.handleTags(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.models).to.have.length(1);
    expect(body.models[0].name).to.equal('bonsai-27b');
    expect(body.models[0].details.format).to.equal('gguf');
  });

  it('GET /api/ps returns running models', async () => {
    const req = new EventEmitter(); req.method = 'GET'; req.url = '/api/ps'; req.headers = {};
    const res = mockRes();
    await compat.handlePs(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.models).to.have.length(1);
  });

  it('POST /api/show returns model details', async () => {
    const req = mockReq({ model: 'bonsai-27b' });
    const res = mockRes();
    await compat.handleShow(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.details.family).to.equal('bonsai');
    expect(body.capabilities).to.include('completion');
  });

  it('POST /api/show returns 404 for unknown model', async () => {
    const req = mockReq({ model: 'nonexistent' });
    const res = mockRes();
    await compat.handleShow(req, res);
    expect(res._statusCode).to.equal(404);
  });

  it('POST /api/chat (non-streaming) returns Ollama chat response', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();
    await compat.handleChat(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.message.role).to.equal('assistant');
    expect(body.message.content).to.equal('Hello world');
    expect(body.done).to.equal(true);
    expect(body.eval_count).to.equal(2);
  });

  it('POST /api/generate (non-streaming) returns Ollama generate response', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      prompt: 'Why is the sky blue?',
      stream: false,
    });
    const res = mockRes();
    await compat.handleGenerate(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.response).to.equal('Hello world');
    expect(body.done).to.equal(true);
  });

  it('POST /api/embed returns embeddings', async () => {
    const req = mockReq({ model: 'bonsai-27b', input: 'Hello' });
    const res = mockRes();
    await compat.handleEmbed(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.embeddings).to.have.length(1);
    expect(body.embeddings[0]).to.deep.equal([0.1, 0.2, 0.3]);
  });

  it('POST /v1/messages (non-streaming) returns Anthropic response', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      stream: false,
    });
    const res = mockRes();
    await compat.handleMessages(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.type).to.equal('message');
    expect(body.role).to.equal('assistant');
    expect(body.content[0].type).to.equal('text');
    expect(body.content[0].text).to.equal('Hello world');
    expect(body.stop_reason).to.equal('end_turn');
    expect(body.usage.input_tokens).to.equal(2);
    expect(body.usage.output_tokens).to.equal(2);
  });

  it('POST /v1/messages with system prompt converts correctly', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      system: 'Be helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      stream: false,
    });
    const res = mockRes();
    await compat.handleMessages(req, res);
    expect(res._statusCode).to.equal(200);
    const body = JSON.parse(res._chunks);
    expect(body.content[0].text).to.equal('Hello world');
  });

  it('POST /api/chat (streaming) emits newline-delimited JSON', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });
    const res = mockRes();
    await compat.handleChat(req, res);
    expect(res._statusCode).to.equal(200);
    expect(res._headers['Content-Type']).to.equal('application/x-ndjson');
    const lines = res._chunks.trim().split('\n').filter(Boolean);
    expect(lines.length).to.be.greaterThan(1);
    const firstChunk = JSON.parse(lines[0]);
    expect(firstChunk.message.content).to.equal('Hello');
    expect(firstChunk.done).to.equal(false);
    const lastChunk = JSON.parse(lines[lines.length - 1]);
    expect(lastChunk.done).to.equal(true);
  });

  it('POST /v1/messages (streaming) emits Anthropic SSE events', async () => {
    const req = mockReq({
      model: 'bonsai-27b',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      stream: true,
    });
    const res = mockRes();
    await compat.handleMessages(req, res);
    expect(res._statusCode).to.equal(200);
    expect(res._headers['Content-Type']).to.equal('text/event-stream');
    // Should contain message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
    expect(res._chunks).to.contain('event: message_start');
    expect(res._chunks).to.contain('event: content_block_start');
    expect(res._chunks).to.contain('event: content_block_delta');
    expect(res._chunks).to.contain('event: content_block_stop');
    expect(res._chunks).to.contain('event: message_delta');
    expect(res._chunks).to.contain('event: message_stop');
    // Should contain the streamed text
    expect(res._chunks).to.contain('Hello');
    expect(res._chunks).to.contain(' world');
  });
});
