/**
 * API Compatibility Layer — Anthropic & Ollama protocol shims
 *
 * Translates Anthropic Messages API (/v1/messages) and Ollama-native API
 * (/api/tags, /api/chat, /api/generate, /api/show, /api/version, /api/ps,
 * /api/embed) requests into the gateway's existing OpenAI-compatible
 * /v1/chat/completions, /v1/completions, /v1/embeddings, and /v1/models
 * endpoints, then converts the responses back to the caller's format.
 *
 * This lets Alpaca act as a drop-in backend for:
 *   - Claude Code (Anthropic SDK) — via /v1/messages
 *   - Any Ollama-compatible client — via /api/*
 *
 * The handlers make internal HTTP loopback calls to the gateway's own
 * endpoints (default: http://127.0.0.1:13439). This reuses all existing
 * slot routing, sampling defaults, tool rewriting, and streaming logic
 * without duplicating it.
 */

const http = require('http');
const { URL } = require('url');

const DEFAULT_GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 13439;
const ALPACA_VERSION = '2.0.1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON request body. Resolves with {} for empty bodies.
 * @private
 */
function _parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Make an internal HTTP request to the gateway's own endpoint.
 * Resolves with { statusCode, headers, body } for non-streaming, or
 * { statusCode, headers, res } for streaming (when onStream is provided).
 * @private
 */
function _gatewayRequest(method, path, body, { host = DEFAULT_GATEWAY_HOST, port = DEFAULT_GATEWAY_PORT, headers = {}, onStream = null } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr != null) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
    }

    const upstreamUrl = `http://${host}:${port}${path}`;
    const upstreamReq = http.request(upstreamUrl, { method, headers: reqHeaders }, (upstreamRes) => {
      if (onStream) {
        resolve({ statusCode: upstreamRes.statusCode, headers: upstreamRes.headers, res: upstreamRes });
        return;
      }
      let responseBody = '';
      upstreamRes.on('data', chunk => { responseBody += chunk; });
      upstreamRes.on('end', () => {
        resolve({ statusCode: upstreamRes.statusCode, headers: upstreamRes.headers, body: responseBody });
      });
      upstreamRes.on('error', reject);
    });

    upstreamReq.on('error', reject);
    if (bodyStr != null) upstreamReq.write(bodyStr);
    upstreamReq.end();
  });
}

/**
 * Send a JSON error response.
 * @private
 */
function _sendJsonError(res, statusCode, message, type = 'error') {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { type, message } }));
}

/**
 * Generate an Anthropic-style message ID.
 * @private
 */
function _anthropicMessageId() {
  return 'msg_alpaca_' + Math.random().toString(36).slice(2, 14);
}

/**
 * Convert Anthropic token usage to a comparable shape.
 * @private
 */
function _usageFromOpenAI(openaiUsage) {
  if (!openaiUsage) return { input_tokens: 0, output_tokens: 0 };
  return {
    input_tokens: openaiUsage.prompt_tokens || 0,
    output_tokens: openaiUsage.completion_tokens || 0,
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages API conversion
// ---------------------------------------------------------------------------

/**
 * Convert an Anthropic Messages request body to an OpenAI chat completions body.
 * @param {Object} anthropicBody - Anthropic request body
 * @returns {Object} OpenAI-compatible request body
 */
function anthropicToOpenAI(anthropicBody) {
  const messages = [];

  // Anthropic system prompt is top-level; OpenAI expects it as a system message.
  const system = anthropicBody.system;
  if (system) {
    const systemText = typeof system === 'string'
      ? system
      : (Array.isArray(system) ? system.map(b => b.text || '').join('\n') : '');
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Convert each Anthropic message to OpenAI format.
  for (const msg of anthropicBody.messages || []) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        messages.push({ role: msg.role, content });
      } else if (Array.isArray(content)) {
        // Content blocks: text, image, tool_use, tool_result
        if (content.length === 1 && content[0].type === 'text') {
          messages.push({ role: msg.role, content: content[0].text });
        } else {
          // Mixed content — convert to OpenAI multi-part content
          const openaiContent = content.map(block => {
            if (block.type === 'text') {
              return { type: 'text', text: block.text };
            }
            if (block.type === 'image') {
              const src = block.source;
              if (src && src.type === 'base64') {
                return {
                  type: 'image_url',
                  image_url: {
                    url: `data:${src.media_type};base64,${src.data}`,
                  },
                };
              }
              return null;
            }
            if (block.type === 'tool_use') {
              // Assistant tool call — represented as OpenAI assistant message with tool_calls
              return { _tool_use: block };
            }
            if (block.type === 'tool_result') {
              // User tool result — represented as OpenAI tool message
              return { _tool_result: block };
            }
            return null;
          }).filter(Boolean);

          // If any tool_use blocks, emit an assistant message with tool_calls
          const toolUses = openaiContent.filter(c => c._tool_use);
          if (toolUses.length > 0) {
            messages.push({
              role: 'assistant',
              content: openaiContent.filter(c => !c._tool_use && !c._tool_result).map(c => c.text).join('') || null,
              tool_calls: toolUses.map(t => ({
                id: t._tool_use.id,
                type: 'function',
                function: {
                  name: t._tool_use.name,
                  arguments: JSON.stringify(t._tool_use.input || {}),
                },
              })),
            });
            // Tool results become separate tool messages
            const toolResults = openaiContent.filter(c => c._tool_result);
            for (const tr of toolResults) {
              const resultContent = typeof tr._tool_result.content === 'string'
                ? tr._tool_result.content
                : (Array.isArray(tr._tool_result.content)
                  ? tr._tool_result.content.map(b => b.text || '').join('')
                  : JSON.stringify(tr._tool_result.content || ''));
              messages.push({
                role: 'tool',
                tool_call_id: tr._tool_result.tool_use_id,
                content: resultContent,
              });
            }
            continue;
          }

          // If any tool_result blocks (without tool_use in same message), emit tool messages
          const toolResultsOnly = openaiContent.filter(c => c._tool_result);
          if (toolResultsOnly.length > 0) {
            for (const tr of toolResultsOnly) {
              const resultContent = typeof tr._tool_result.content === 'string'
                ? tr._tool_result.content
                : (Array.isArray(tr._tool_result.content)
                  ? tr._tool_result.content.map(b => b.text || '').join('')
                  : JSON.stringify(tr._tool_result.content || ''));
              messages.push({
                role: 'tool',
                tool_call_id: tr._tool_result.tool_use_id,
                content: resultContent,
              });
            }
            continue;
          }

          // Plain multi-part content (text + images)
          messages.push({ role: msg.role, content: openaiContent });
        }
      }
    }
  }

  const openaiBody = {
    model: anthropicBody.model || '',
    messages,
    max_tokens: anthropicBody.max_tokens || 4096,
    stream: anthropicBody.stream === true,
  };

  if (anthropicBody.temperature != null) openaiBody.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p != null) openaiBody.top_p = anthropicBody.top_p;
  if (anthropicBody.stop_sequences) openaiBody.stop = anthropicBody.stop_sequences;

  // Convert Anthropic tools to OpenAI tools
  if (Array.isArray(anthropicBody.tools) && anthropicBody.tools.length > 0) {
    openaiBody.tools = anthropicBody.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }

  // Reasoning/thinking — map Anthropic thinking field to reasoning_format
  if (anthropicBody.thinking && anthropicBody.thinking.type === 'enabled') {
    openaiBody.reasoning_format = 'auto';
  }

  return openaiBody;
}

/**
 * Convert an OpenAI chat completion response to Anthropic Messages format.
 * @param {Object} openaiBody - Parsed OpenAI response body
 * @param {string} model - Model name
 * @returns {Object} Anthropic Messages response
 */
function openAIToAnthropic(openaiBody, model) {
  const choice = openaiBody.choices && openaiBody.choices[0];
  const message = choice ? choice.message : {};
  const content = [];

  // Extract reasoning/thinking if present
  if (message.reasoning_content) {
    content.push({ type: 'thinking', thinking: message.reasoning_content });
  }

  // Extract text content
  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Extract tool calls
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* keep empty */ }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  const stopReasonMap = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'end_turn',
  };

  return {
    id: _anthropicMessageId(),
    type: 'message',
    role: 'assistant',
    model: model || openaiBody.model || '',
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: stopReasonMap[choice && choice.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: _usageFromOpenAI(openaiBody.usage),
  };
}

// ---------------------------------------------------------------------------
// Ollama API conversion
// ---------------------------------------------------------------------------

/**
 * Convert an Ollama /api/chat request to OpenAI chat completions format.
 * @param {Object} ollamaBody - Ollama chat request
 * @returns {Object} OpenAI-compatible request body
 */
function ollamaChatToOpenAI(ollamaBody) {
  const messages = [];

  // Ollama system field (top-level) -> system message
  if (ollamaBody.system) {
    messages.push({ role: 'system', content: ollamaBody.system });
  }

  for (const msg of ollamaBody.messages || []) {
    const role = msg.role || 'user';
    if (typeof msg.content === 'string') {
      messages.push({ role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Ollama multi-part content (text + images)
      const parts = [];
      const images = msg.images || [];
      for (const block of msg.content) {
        if (block.type === 'text') parts.push({ type: 'text', text: block.text });
      }
      // Ollama also supports top-level images array (base64 without data: prefix)
      for (const img of images) {
        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
      }
      messages.push({ role, content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
    } else {
      messages.push({ role, content: msg.content || '' });
    }
  }

  // Top-level images on the last user message (Ollama generate-style)
  if (Array.isArray(ollamaBody.images) && ollamaBody.images.length > 0) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser && typeof lastUser.content === 'string') {
      lastUser.content = [{ type: 'text', text: lastUser.content },
        ...ollamaBody.images.map(img => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } }))];
    }
  }

  const openaiBody = {
    model: ollamaBody.model || '',
    messages,
    stream: ollamaBody.stream !== false,
  };

  // Ollama options -> OpenAI params
  const opts = ollamaBody.options || {};
  if (opts.temperature != null) openaiBody.temperature = opts.temperature;
  if (opts.top_p != null) openaiBody.top_p = opts.top_p;
  if (opts.top_k != null) openaiBody.top_k = opts.top_k;
  if (opts.seed != null) openaiBody.seed = opts.seed;
  if (opts.num_predict != null) openaiBody.max_tokens = opts.num_predict;
  if (opts.stop) openaiBody.stop = Array.isArray(opts.stop) ? opts.stop : [opts.stop];
  if (opts.repeat_penalty != null) openaiBody.repeat_penalty = opts.repeat_penalty;
  if (opts.presence_penalty != null) openaiBody.presence_penalty = opts.presence_penalty;
  if (opts.frequency_penalty != null) openaiBody.frequency_penalty = opts.frequency_penalty;

  // Ollama format -> OpenAI response_format
  if (ollamaBody.format === 'json') {
    openaiBody.response_format = { type: 'json_object' };
  } else if (ollamaBody.format && typeof ollamaBody.format === 'object') {
    openaiBody.response_format = { type: 'json_schema', json_schema: ollamaBody.format };
  }

  // Ollama tools -> OpenAI tools
  if (Array.isArray(ollamaBody.tools) && ollamaBody.tools.length > 0) {
    openaiBody.tools = ollamaBody.tools.map(t => ({
      type: 'function',
      function: {
        name: t.function && t.function.name ? t.function.name : t.name,
        description: (t.function && t.function.description) || t.description || '',
        parameters: (t.function && t.function.parameters) || t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  // Thinking
  if (ollamaBody.think) {
    openaiBody.reasoning_format = 'auto';
  }

  return openaiBody;
}

/**
 * Convert an OpenAI chat completion response to Ollama /api/chat format.
 * @param {Object} openaiBody - Parsed OpenAI response body
 * @returns {Object} Ollama chat response
 */
function openAIToOllamaChat(openaiBody) {
  const choice = openaiBody.choices && openaiBody.choices[0];
  const message = choice ? choice.message : {};
  const content = message.content || '';

  const resp = {
    model: openaiBody.model || '',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done: true,
    done_reason: choice ? choice.finish_reason : 'stop',
  };

  if (message.reasoning_content) {
    resp.message.thinking = message.reasoning_content;
  }

  if (openaiBody.usage) {
    resp.prompt_eval_count = openaiBody.usage.prompt_tokens || 0;
    resp.eval_count = openaiBody.usage.completion_tokens || 0;
    resp.total_duration = 0;
    resp.prompt_eval_duration = 0;
    resp.eval_duration = 0;
  }

  return resp;
}

/**
 * Convert an Ollama /api/generate request to OpenAI completions format.
 * @param {Object} ollamaBody - Ollama generate request
 * @returns {Object} OpenAI-compatible completions request body
 */
function ollamaGenerateToOpenAI(ollamaBody) {
  const messages = [];
  if (ollamaBody.system) {
    messages.push({ role: 'system', content: ollamaBody.system });
  }
  messages.push({ role: 'user', content: ollamaBody.prompt || '' });

  // /api/generate maps to chat completions (not legacy completions) so the
  // chat template is applied. This matches Ollama's behavior.
  const openaiBody = {
    model: ollamaBody.model || '',
    messages,
    stream: ollamaBody.stream !== false,
  };

  const opts = ollamaBody.options || {};
  if (opts.temperature != null) openaiBody.temperature = opts.temperature;
  if (opts.top_p != null) openaiBody.top_p = opts.top_p;
  if (opts.top_k != null) openaiBody.top_k = opts.top_k;
  if (opts.seed != null) openaiBody.seed = opts.seed;
  if (opts.num_predict != null) openaiBody.max_tokens = opts.num_predict;
  if (opts.stop) openaiBody.stop = Array.isArray(opts.stop) ? opts.stop : [opts.stop];

  if (ollamaBody.format === 'json') {
    openaiBody.response_format = { type: 'json_object' };
  } else if (ollamaBody.format && typeof ollamaBody.format === 'object') {
    openaiBody.response_format = { type: 'json_schema', json_schema: ollamaBody.format };
  }

  if (ollamaBody.think) {
    openaiBody.reasoning_format = 'auto';
  }

  return openaiBody;
}

/**
 * Convert an OpenAI chat completion response to Ollama /api/generate format.
 * @param {Object} openaiBody - Parsed OpenAI response body
 * @returns {Object} Ollama generate response
 */
function openAIToOllamaGenerate(openaiBody) {
  const choice = openaiBody.choices && openaiBody.choices[0];
  const message = choice ? choice.message : {};
  const resp = {
    model: openaiBody.model || '',
    created_at: new Date().toISOString(),
    response: message.content || '',
    done: true,
    done_reason: choice ? choice.finish_reason : 'stop',
  };

  if (message.reasoning_content) {
    resp.thinking = message.reasoning_content;
  }

  if (openaiBody.usage) {
    resp.prompt_eval_count = openaiBody.usage.prompt_tokens || 0;
    resp.eval_count = openaiBody.usage.completion_tokens || 0;
  }

  return resp;
}

/**
 * Convert an OpenAI model list entry to an Ollama model entry.
 * @param {Object} openaiModel - { id, owned_by, ... }
 * @returns {Object} Ollama model entry
 */
function openAIModelToOllama(openaiModel) {
  const name = openaiModel.id || 'unknown';
  return {
    name,
    model: name,
    modified_at: new Date().toISOString(),
    size: 0,
    digest: 'sha256:' + (openaiModel.id || 'unknown').replace(/[^a-z0-9]/gi, '').padEnd(12, '0').slice(0, 12),
    details: {
      parent_model: '',
      format: 'gguf',
      family: openaiModel.owned_by || 'alpaca',
      parameter_size: '',
      quantization_level: '',
    },
  };
}

// ---------------------------------------------------------------------------
// Handler class
// ---------------------------------------------------------------------------

/**
 * API Compatibility handler. Translates Anthropic and Ollama protocol
 * requests to the gateway's OpenAI-compatible endpoints.
 */
class ApiCompat {
  /**
   * @param {Object} options
   * @param {number} [options.gatewayPort=13439] - Gateway port for internal loopback
   * @param {Object} [options.slotManager] - SlotManager (for /api/ps and /api/show)
   * @param {Object} [options.logger=console]
   */
  constructor({ gatewayPort = DEFAULT_GATEWAY_PORT, slotManager = null, logger = console } = {}) {
    this.gatewayHost = DEFAULT_GATEWAY_HOST;
    this.gatewayPort = gatewayPort;
    this.slotManager = slotManager;
    this.logger = logger;
  }

  // --- Anthropic Messages API ---------------------------------------------

  /**
   * Handle POST /v1/messages (Anthropic Messages API).
   */
  async handleMessages(req, res) {
    try {
      const anthropicBody = await _parseBody(req);
      const openaiBody = anthropicToOpenAI(anthropicBody);
      const isStreaming = openaiBody.stream === true;

      if (isStreaming) {
        await this._streamMessages(anthropicBody, openaiBody, res);
      } else {
        const result = await _gatewayRequest('POST', '/v1/chat/completions', openaiBody, {
          host: this.gatewayHost, port: this.gatewayPort,
        });
        if (result.statusCode !== 200) {
          _sendJsonError(res, result.statusCode, result.body || 'upstream_error', 'api_error');
          return;
        }
        let openaiResp;
        try { openaiResp = JSON.parse(result.body); } catch (_) {
          _sendJsonError(res, 502, 'Invalid upstream response', 'api_error');
          return;
        }
        const anthropicResp = openAIToAnthropic(openaiResp, anthropicBody.model);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (err) {
      this.logger.error('[ApiCompat] /v1/messages error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error', 'api_error');
    }
  }

  /**
   * Stream an Anthropic Messages response by translating OpenAI SSE chunks
   * into Anthropic SSE events.
   * @private
   */
  async _streamMessages(anthropicBody, openaiBody, res) {
    const model = anthropicBody.model || '';
    const msgId = _anthropicMessageId();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (eventType, data) => {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // message_start
    send('message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    // content_block_start (text block at index 0)
    send('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });

    let contentBlockOpen = true;
    let currentBlockIndex = 0;
    let totalOutputTokens = 0;
    let stopReason = 'end_turn';
    let sawToolCall = false;

    try {
      const result = await _gatewayRequest('POST', '/v1/chat/completions', openaiBody, {
        host: this.gatewayHost, port: this.gatewayPort,
        onStream: (upstreamRes) => upstreamRes.res,
      });

      if (result.statusCode !== 200) {
        // Emit an error text delta and close
        send('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `[upstream error: ${result.statusCode}]` },
        });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 },
        });
        send('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }

      const upstream = result.res;
      let buffer = '';

      await new Promise((resolve, reject) => {
        upstream.on('data', chunk => {
          buffer += chunk.toString('utf8');
          // Process complete SSE lines
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line || !line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') { resolve(); return; }
            try {
              const json = JSON.parse(payload);
              this._processOpenAIChunkForAnthropic(json, send, {
                msgId, model,
                contentBlockOpen, currentBlockIndex,
                setState: (s) => {
                  contentBlockOpen = s.contentBlockOpen;
                  currentBlockIndex = s.currentBlockIndex;
                  if (s.sawToolCall) sawToolCall = true;
                  if (s.stopReason) stopReason = s.stopReason;
                },
                addTokens: (n) => { totalOutputTokens += n; },
              });
            } catch (_) { /* skip malformed */ }
          }
        });
        upstream.on('end', resolve);
        upstream.on('error', reject);
      });

      // Close any open content block
      if (contentBlockOpen) {
        send('content_block_stop', { type: 'content_block_stop', index: currentBlockIndex });
      }

      // message_delta
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: sawToolCall ? 'tool_use' : stopReason, stop_sequence: null },
        usage: { output_tokens: totalOutputTokens },
      });

      // message_stop
      send('message_stop', { type: 'message_stop' });
      res.end();
    } catch (err) {
      this.logger.error('[ApiCompat] _streamMessages error:', err);
      try {
        if (contentBlockOpen) {
          send('content_block_stop', { type: 'content_block_stop', index: currentBlockIndex });
        }
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: totalOutputTokens },
        });
        send('message_stop', { type: 'message_stop' });
      } catch (_) { /* best effort */ }
      res.end();
    }
  }

  /**
   * Process one OpenAI SSE chunk and emit corresponding Anthropic events.
   * @private
   */
  _processOpenAIChunkForAnthropic(json, send, state) {
    const choice = json.choices && json.choices[0];
    if (!choice) {
      // Usage-only chunk
      if (json.usage) state.addTokens(json.usage.completion_tokens || 0);
      return;
    }

    const delta = choice.delta || {};

    // Reasoning content -> thinking delta
    if (delta.reasoning_content) {
      // Open a thinking block if needed
      if (state.contentBlockOpen) {
        send('content_block_stop', { type: 'content_block_stop', index: state.currentBlockIndex });
        state.setState({ ...state, contentBlockOpen: false });
      }
      const thinkingIndex = state.currentBlockIndex + 1;
      send('content_block_start', {
        type: 'content_block_start',
        index: thinkingIndex,
        content_block: { type: 'thinking', thinking: '' },
      });
      send('content_block_delta', {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      });
      send('content_block_stop', { type: 'content_block_stop', index: thinkingIndex });
      state.setState({ ...state, currentBlockIndex: thinkingIndex, contentBlockOpen: false });
      // Reopen text block
      const textIndex = thinkingIndex + 1;
      send('content_block_start', {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'text', text: '' },
      });
      state.setState({ ...state, currentBlockIndex: textIndex, contentBlockOpen: true });
    }

    // Text content
    if (delta.content) {
      if (!state.contentBlockOpen) {
        const textIndex = state.currentBlockIndex + 1;
        send('content_block_start', {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        });
        state.setState({ ...state, currentBlockIndex: textIndex, contentBlockOpen: true });
      }
      send('content_block_delta', {
        type: 'content_block_delta',
        index: state.currentBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      });
    }

    // Tool calls
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (state.contentBlockOpen) {
          send('content_block_stop', { type: 'content_block_stop', index: state.currentBlockIndex });
          state.setState({ ...state, contentBlockOpen: false });
        }
        const toolIndex = state.currentBlockIndex + 1;
        const toolId = tc.id || ('toolu_alpaca_' + toolIndex);
        const toolName = tc.function && tc.function.name ? tc.function.name : '';
        send('content_block_start', {
          type: 'content_block_start',
          index: toolIndex,
          content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} },
        });
        if (tc.function && tc.function.arguments) {
          send('content_block_delta', {
            type: 'content_block_delta',
            index: toolIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          });
        }
        send('content_block_stop', { type: 'content_block_stop', index: toolIndex });
        state.setState({ ...state, currentBlockIndex: toolIndex, contentBlockOpen: false, sawToolCall: true });
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      const stopMap = {
        stop: 'end_turn',
        length: 'max_tokens',
        tool_calls: 'tool_use',
        content_filter: 'end_turn',
      };
      state.setState({ ...state, stopReason: stopMap[choice.finish_reason] || 'end_turn' });
    }

    // Usage
    if (json.usage) {
      state.addTokens(json.usage.completion_tokens || 0);
    }
  }

  // --- Ollama API ----------------------------------------------------------

  /**
   * Handle GET /api/tags — list local models (Ollama format).
   */
  async handleTags(req, res) {
    try {
      const result = await _gatewayRequest('GET', '/v1/models', null, {
        host: this.gatewayHost, port: this.gatewayPort,
      });
      if (result.statusCode !== 200) {
        _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
        return;
      }
      let openaiResp;
      try { openaiResp = JSON.parse(result.body); } catch (_) {
        _sendJsonError(res, 502, 'Invalid upstream response');
        return;
      }
      const models = (openaiResp.data || []).map(openAIModelToOllama);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    } catch (err) {
      this.logger.error('[ApiCompat] /api/tags error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }

  /**
   * Handle GET /api/ps — list running models (Ollama format).
   */
  async handlePs(req, res) {
    try {
      const result = await _gatewayRequest('GET', '/v1/models', null, {
        host: this.gatewayHost, port: this.gatewayPort,
      });
      if (result.statusCode !== 200) {
        _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
        return;
      }
      let openaiResp;
      try { openaiResp = JSON.parse(result.body); } catch (_) {
        _sendJsonError(res, 502, 'Invalid upstream response');
        return;
      }
      // /api/ps returns only currently loaded models. Since /v1/models already
      // only returns active slots, we map directly.
      const models = (openaiResp.data || []).map(openAIModelToOllama);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    } catch (err) {
      this.logger.error('[ApiCompat] /api/ps error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }

  /**
   * Handle GET /api/version — return version info.
   */
  async handleVersion(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: ALPACA_VERSION }));
  }

  /**
   * Handle POST /api/show — show model details (Ollama format).
   */
  async handleShow(req, res) {
    try {
      const body = await _parseBody(req);
      const modelName = body.model || body.name || '';
      if (!modelName) {
        _sendJsonError(res, 400, 'model is required');
        return;
      }
      // Fetch models list and find the requested one
      const result = await _gatewayRequest('GET', '/v1/models', null, {
        host: this.gatewayHost, port: this.gatewayPort,
      });
      if (result.statusCode !== 200) {
        _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
        return;
      }
      let openaiResp;
      try { openaiResp = JSON.parse(result.body); } catch (_) {
        _sendJsonError(res, 502, 'Invalid upstream response');
        return;
      }
      const found = (openaiResp.data || []).find(m => m.id === modelName);
      if (!found) {
        _sendJsonError(res, 404, `model '${modelName}' not found`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        modelfile: '',
        parameters: '',
        template: '',
        details: {
          parent_model: '',
          format: 'gguf',
          family: found.owned_by || 'alpaca',
          families: [found.owned_by || 'alpaca'],
          parameter_size: '',
          quantization_level: '',
        },
        model_info: {},
        capabilities: ['completion'],
        modified_at: new Date().toISOString(),
      }));
    } catch (err) {
      this.logger.error('[ApiCompat] /api/show error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }

  /**
   * Handle POST /api/chat — Ollama chat completions.
   */
  async handleChat(req, res) {
    try {
      const ollamaBody = await _parseBody(req);
      const openaiBody = ollamaChatToOpenAI(ollamaBody);
      const isStreaming = openaiBody.stream === true;

      if (isStreaming) {
        await this._streamOllamaChat(ollamaBody, openaiBody, res, 'chat');
      } else {
        const result = await _gatewayRequest('POST', '/v1/chat/completions', openaiBody, {
          host: this.gatewayHost, port: this.gatewayPort,
        });
        if (result.statusCode !== 200) {
          _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
          return;
        }
        let openaiResp;
        try { openaiResp = JSON.parse(result.body); } catch (_) {
          _sendJsonError(res, 502, 'Invalid upstream response');
          return;
        }
        const ollamaResp = openAIToOllamaChat(openaiResp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ollamaResp));
      }
    } catch (err) {
      this.logger.error('[ApiCompat] /api/chat error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }

  /**
   * Handle POST /api/generate — Ollama text generation.
   */
  async handleGenerate(req, res) {
    try {
      const ollamaBody = await _parseBody(req);
      const openaiBody = ollamaGenerateToOpenAI(ollamaBody);
      const isStreaming = openaiBody.stream === true;

      if (isStreaming) {
        await this._streamOllamaChat(ollamaBody, openaiBody, res, 'generate');
      } else {
        const result = await _gatewayRequest('POST', '/v1/chat/completions', openaiBody, {
          host: this.gatewayHost, port: this.gatewayPort,
        });
        if (result.statusCode !== 200) {
          _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
          return;
        }
        let openaiResp;
        try { openaiResp = JSON.parse(result.body); } catch (_) {
          _sendJsonError(res, 502, 'Invalid upstream response');
          return;
        }
        const ollamaResp = openAIToOllamaGenerate(openaiResp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ollamaResp));
      }
    } catch (err) {
      this.logger.error('[ApiCompat] /api/generate error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }

  /**
   * Stream an Ollama chat or generate response by translating OpenAI SSE
   * chunks into newline-delimited JSON objects (Ollama streaming format).
   * @private
   */
  async _streamOllamaChat(ollamaBody, openaiBody, res, mode) {
    const model = ollamaBody.model || '';

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
    };

    let promptEvalCount = 0;
    let evalCount = 0;

    try {
      const result = await _gatewayRequest('POST', '/v1/chat/completions', openaiBody, {
        host: this.gatewayHost, port: this.gatewayPort,
        onStream: (upstreamRes) => upstreamRes.res,
      });

      if (result.statusCode !== 200) {
        const errObj = mode === 'chat'
          ? { model, created_at: new Date().toISOString(), message: { role: 'assistant', content: `[upstream error: ${result.statusCode}]` }, done: false, error: 'upstream_error' }
          : { model, created_at: new Date().toISOString(), response: `[upstream error: ${result.statusCode}]`, done: false, error: 'upstream_error' };
        send(errObj);
        send({ model, created_at: new Date().toISOString(), response: '', message: { role: 'assistant', content: '' }, done: true, done_reason: 'error', total_duration: 0, prompt_eval_count: 0, eval_count: 0 });
        res.end();
        return;
      }

      const upstream = result.res;
      let buffer = '';

      await new Promise((resolve, reject) => {
        upstream.on('data', chunk => {
          buffer += chunk.toString('utf8');
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line || !line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') { resolve(); return; }
            try {
              const json = JSON.parse(payload);
              const choice = json.choices && json.choices[0];
              if (!choice) {
                if (json.usage) {
                  promptEvalCount = json.usage.prompt_tokens || 0;
                  evalCount = json.usage.completion_tokens || 0;
                }
                continue;
              }
              const delta = choice.delta || {};
              const textChunk = delta.content || '';
              const thinkingChunk = delta.reasoning_content || '';

              if (textChunk || thinkingChunk) {
                if (mode === 'chat') {
                  send({
                    model,
                    created_at: new Date().toISOString(),
                    message: { role: 'assistant', content: textChunk, ...(thinkingChunk ? { thinking: thinkingChunk } : {}) },
                    done: false,
                  });
                } else {
                  send({
                    model,
                    created_at: new Date().toISOString(),
                    response: textChunk,
                    ...(thinkingChunk ? { thinking: thinkingChunk } : {}),
                    done: false,
                  });
                }
              }

              // Tool calls in streaming
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const toolName = tc.function && tc.function.name ? tc.function.name : '';
                  const args = tc.function && tc.function.arguments ? tc.function.arguments : '';
                  if (mode === 'chat') {
                    send({
                      model,
                      created_at: new Date().toISOString(),
                      message: {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                          function: { name: toolName, arguments: args },
                        }],
                      },
                      done: false,
                    });
                  }
                }
              }

              if (json.usage) {
                promptEvalCount = json.usage.prompt_tokens || 0;
                evalCount = json.usage.completion_tokens || 0;
              }
            } catch (_) { /* skip malformed */ }
          }
        });
        upstream.on('end', resolve);
        upstream.on('error', reject);
      });

      // Final done message
      const doneObj = mode === 'chat'
        ? {
            model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '' },
            done: true,
            done_reason: 'stop',
            total_duration: 0,
            prompt_eval_count: promptEvalCount,
            prompt_eval_duration: 0,
            eval_count: evalCount,
            eval_duration: 0,
          }
        : {
            model,
            created_at: new Date().toISOString(),
            response: '',
            done: true,
            done_reason: 'stop',
            total_duration: 0,
            prompt_eval_count: promptEvalCount,
            prompt_eval_duration: 0,
            eval_count: evalCount,
            eval_duration: 0,
          };
      send(doneObj);
      res.end();
    } catch (err) {
      this.logger.error('[ApiCompat] _streamOllamaChat error:', err);
      try {
        send({
          model,
          created_at: new Date().toISOString(),
          ...(mode === 'chat' ? { message: { role: 'assistant', content: '' } } : { response: '' }),
          done: true,
          done_reason: 'error',
        });
      } catch (_) { /* best effort */ }
      res.end();
    }
  }

  /**
   * Handle POST /api/embed — Ollama embeddings.
   */
  async handleEmbed(req, res) {
    try {
      const ollamaBody = await _parseBody(req);
      const input = ollamaBody.input;
      const openaiBody = {
        model: ollamaBody.model || '',
        input: Array.isArray(input) ? input : (input || ''),
      };

      const result = await _gatewayRequest('POST', '/v1/embeddings', openaiBody, {
        host: this.gatewayHost, port: this.gatewayPort,
      });
      if (result.statusCode !== 200) {
        _sendJsonError(res, result.statusCode, result.body || 'upstream_error');
        return;
      }
      let openaiResp;
      try { openaiResp = JSON.parse(result.body); } catch (_) {
        _sendJsonError(res, 502, 'Invalid upstream response');
        return;
      }
      // OpenAI returns { data: [{ embedding: [...] }] }
      const embeddings = (openaiResp.data || []).map(d => d.embedding || []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: ollamaBody.model || openaiResp.model || '',
        embeddings,
        total_duration: 0,
        load_duration: 0,
        prompt_eval_count: openaiResp.usage ? openaiResp.usage.prompt_tokens || 0 : 0,
      }));
    } catch (err) {
      this.logger.error('[ApiCompat] /api/embed error:', err);
      _sendJsonError(res, 500, err.message || 'internal_server_error');
    }
  }
}

module.exports = {
  ApiCompat,
  ALPACA_VERSION,
  // Exported for testing
  anthropicToOpenAI,
  openAIToAnthropic,
  ollamaChatToOpenAI,
  openAIToOllamaChat,
  ollamaGenerateToOpenAI,
  openAIToOllamaGenerate,
  openAIModelToOllama,
};
