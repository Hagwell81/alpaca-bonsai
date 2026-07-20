/**
 * API Gateway — Unified HTTP/SSE proxy on port 13439
 *
 * Routes requests to the appropriate slot based on content and model.
 * Aggregates cross-slot endpoints (/v1/models, /v1/slots/status, etc.).
 * Handles response rewriting for tool calls and grammar injection.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 11.1, 11.2, 11.3, 11.4, 13.2, 13.3, 13.4, 14.3, 14.4
 */

const http = require('http');
const { URL } = require('url');
const { pipeline } = require('stream');
const { selectSlot } = require('./slot-selector');
const { DEFAULT_ADVANCED_ARGS } = require('./advanced-args');
const { ToolRewriterStream } = require('./tool-rewriter');
const { ApiCompat } = require('./api-compat');

/**
 * Custom error for gateway bind failures
 */
class GatewayBindError extends Error {
  constructor(message, port) {
    super(message);
    this.name = 'GatewayBindError';
    this.port = port;
  }
}

/**
 * API Gateway class
 *
 * Thin HTTP/SSE proxy on port 13439. Routes requests to the appropriate slot
 * and aggregates cross-slot endpoints.
 */
class ApiGateway {
  /**
   * Constructor
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.slotManager - The SlotManager instance
   * @param {Object} options.vramBudgetManager - The VramBudgetManager instance
   * @param {Object} options.grammarLibrary - The GrammarLibrary instance
   * @param {Object} options.toolRewriter - The ToolRewriter instance
   * @param {Object} options.desktopServices - Desktop model management services (optional)
   * @param {Function} [options.desktopServices.getInstalledModels] - List installed GGUF models
   * @param {Function} [options.desktopServices.searchHuggingFaceRepo] - Search HF for GGUF files
   * @param {Function} [options.desktopServices.downloadHuggingFaceModel] - Download a model from HF
   * @param {Function} [options.desktopServices.getDownloadProgress] - Poll download progress
   * @param {Function} [options.desktopServices.deleteModel] - Delete an installed model
   * @param {Object} options.logger - Logger instance (default: console)
   */
  constructor({
    slotManager,
    vramBudgetManager,
    grammarLibrary,
    toolRewriter,
    desktopServices = null,
    logger = console,
  } = {}) {
    this.slotManager = slotManager;
    this.vramBudgetManager = vramBudgetManager;
    this.grammarLibrary = grammarLibrary;
    this.desktopServices = desktopServices;
    this.toolRewriter = toolRewriter;
    this.logger = logger;

    this.server = null;
    this.isShuttingDown = false;

    // Compatibility shim for Anthropic Messages API and Ollama-native API.
    // Routes through the gateway's own OpenAI-compatible endpoints via
    // internal HTTP loopback (127.0.0.1:13439).
    this.apiCompat = new ApiCompat({
      gatewayPort: 13439,
      slotManager,
      logger,
    });

    // Route table: (method, pathname) -> handler
    this.routes = new Map();
    this._registerRoutes();
  }

  /**
   * Register all route handlers
   * @private
   */
  _registerRoutes() {
    // Format: "METHOD /path" -> handler
    this.routes.set('POST /v1/chat/completions', (req, res) => this._handleChatCompletions(req, res));
    this.routes.set('POST /v1/completions', (req, res) => this._handleCompletions(req, res));
    this.routes.set('POST /v1/embeddings', (req, res) => this._handleEmbeddings(req, res));
    this.routes.set('GET /v1/models', (req, res) => this._handleModels(req, res));
    this.routes.set('GET /v1/slots/status', (req, res) => this._handleSlotsStatus(req, res));
    this.routes.set('POST /tokenize', (req, res) => this._handleTokenize(req, res));
    this.routes.set('POST /detokenize', (req, res) => this._handleDetokenize(req, res));
    this.routes.set('GET /health', (req, res) => this._handleHealth(req, res));
    this.routes.set('GET /metrics', (req, res) => this._handleMetrics(req, res));
    this.routes.set('GET /props', (req, res) => this._handleProps(req, res));
    // Image generation (sd.cpp / Bonsai Image 4B) — proxies to ImageService
    this.routes.set('POST /v1/images/generations', (req, res) => this._handleImageGenerations(req, res));
    this.routes.set('GET /v1/images/status', (req, res) => this._handleImageStatus(req, res));

    // Desktop model management — mirrors Electron IPC handlers so the webui
    // can manage models via HTTP when not running inside Electron (e.g. the
    // standalone webui used for UI testing). All handlers no-op when
    // desktopServices is not configured.
    this.routes.set('GET /v1/desktop/installed-models', (req, res) => this._handleGetInstalledModels(req, res));
    this.routes.set('POST /v1/desktop/huggingface/search', (req, res) => this._handleHuggingFaceSearch(req, res));
    this.routes.set('POST /v1/desktop/huggingface/download', (req, res) => this._handleHuggingFaceDownload(req, res));
    this.routes.set('GET /v1/desktop/download-progress', (req, res) => this._handleGetDownloadProgress(req, res));
    this.routes.set('POST /v1/desktop/models/delete', (req, res) => this._handleDeleteModel(req, res));

    // Anthropic Messages API — lets Claude Code and the Anthropic SDK use
    // Alpaca as a backend. Translates to /v1/chat/completions internally.
    this.routes.set('POST /v1/messages', (req, res) => this.apiCompat.handleMessages(req, res));

    // Ollama-native API — lets any Ollama-compatible client use Alpaca as a
    // backend. Translates to the gateway's OpenAI-compatible endpoints.
    this.routes.set('GET /api/tags', (req, res) => this.apiCompat.handleTags(req, res));
    this.routes.set('GET /api/ps', (req, res) => this.apiCompat.handlePs(req, res));
    this.routes.set('GET /api/version', (req, res) => this.apiCompat.handleVersion(req, res));
    this.routes.set('POST /api/show', (req, res) => this.apiCompat.handleShow(req, res));
    this.routes.set('POST /api/chat', (req, res) => this.apiCompat.handleChat(req, res));
    this.routes.set('POST /api/generate', (req, res) => this.apiCompat.handleGenerate(req, res));
    this.routes.set('POST /api/embed', (req, res) => this.apiCompat.handleEmbed(req, res));
    // Alias: Ollama also exposes /api/embeddings for backwards compat
    this.routes.set('POST /api/embeddings', (req, res) => this.apiCompat.handleEmbed(req, res));
  }

  /**
   * Start the gateway server
   *
   * Binds to 127.0.0.1:13439 and begins accepting requests.
   * Throws GatewayBindError if the port is already in use.
   *
   * Requirements: 5.1, 5.4
   *
   * @returns {Promise<void>}
   * @throws {GatewayBindError} If port 13439 is already in use
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new GatewayBindError(
            'Port 13439 is already in use. Cannot start API Gateway.',
            13439
          ));
        } else {
          reject(err);
        }
      });

      this.server.listen(13439, '127.0.0.1', () => {
        this.logger.log('[ApiGateway] Started on 127.0.0.1:13439');
        resolve();
      });
    });
  }

  /**
   * Main request handler
   * @private
   */
  _handleRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1:13439');
    const routeKey = req.method + ' ' + url.pathname;

    // CORS preflight for desktop management endpoints, the Anthropic
    // shim, and the Ollama shim — allows the standalone webui (served
    // from a different origin) and external SDKs to call these
    // endpoints. The chat completion endpoints are already same-origin
    // in production (Electron loads the webui from the gateway itself).
    const isCorsPath = url.pathname.startsWith('/v1/desktop/') ||
                       url.pathname.startsWith('/api/') ||
                       url.pathname === '/v1/messages';
    if (req.method === 'OPTIONS' && isCorsPath) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    const handler = this.routes.get(routeKey);
    if (!handler) {
      return this._handle404(req, res);
    }

    // Attach permissive CORS headers for desktop management, Anthropic,
    // and Ollama endpoints so external clients can call them cross-origin.
    if (isCorsPath) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
    }

    handler(req, res);
  }

  /**
   * Handle 404 responses
   * @private
   */
  _handle404(req, res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'path not supported' }));
  }

  /**
   * Parse JSON request body
   * @private
   */
  async _parseBody(req, maxSize = 10 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          return;
        }
        data += chunk.toString('utf8');
      });

      req.on('end', () => {
        try {
          const body = data ? JSON.parse(data) : {};
          resolve(body);
        } catch (err) {
          reject(new Error('Invalid JSON in request body'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Apply sampling parameter defaults to request body
   *
   * Injects per-model Sampling_Params defaults for missing fields only.
   * Does not override fields that are already present in the request.
   * Creates a deep copy to avoid mutating the original body.
   *
   * Requirements: 11.2, 11.3
   *
   * @private
   */
  _applySamplingDefaults(body, defaults) {
    if (!body) return body;

    // Create a deep copy to avoid mutating the original body
    const rewritten = JSON.parse(JSON.stringify(body));

    const samplingDefaults = (defaults && defaults.sampling) || DEFAULT_ADVANCED_ARGS.sampling;

    // Map internal camelCase config keys to OpenAI-compatible API parameter names.
    // The internal config uses { temp, topK, topP, repeatPenalty, presencePenalty,
    // frequencyPenalty, seed } but the /v1/chat/completions endpoint expects
    // { temperature, top_k, top_p, repeat_penalty, presence_penalty,
    // frequency_penalty, seed }. Without this mapping, the defaults are silently
    // ignored by llama-server.
    const KEY_MAP = {
      temp: 'temperature',
      topK: 'top_k',
      topP: 'top_p',
      repeatPenalty: 'repeat_penalty',
      presencePenalty: 'presence_penalty',
      frequencyPenalty: 'frequency_penalty',
      seed: 'seed', // already correct
    };

    // Only inject defaults for fields that are missing (using OpenAI key names)
    for (const [internalKey, openaiKey] of Object.entries(KEY_MAP)) {
      if (!(internalKey in samplingDefaults)) continue;
      // Don't override if the caller already set either the OpenAI or internal key
      if (!(openaiKey in rewritten) && !(internalKey in rewritten)) {
        rewritten[openaiKey] = samplingDefaults[internalKey];
      }
    }

    return rewritten;
  }

  /**
   * Validate sampling parameters against allowed ranges
   *
   * Requirements: 11.1, 11.4
   *
   * @private
   */
  _validateSamplingParams(body) {
    const ranges = {
      temperature: [0.0, 2.0],
      top_k: [0, 1000],
      top_p: [0.0, 1.0],
      repeat_penalty: [0.0, 2.0],
      presence_penalty: [-2.0, 2.0],
      frequency_penalty: [-2.0, 2.0],
    };

    for (const [field, [min, max]] of Object.entries(ranges)) {
      if (field in body) {
        const val = body[field];
        if (typeof val !== 'number' || val < min || val > max) {
          return { valid: false, field, min, max };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Handle /v1/chat/completions requests
   *
   * Request-side pipeline:
   * 1. Extract lastUserMessageText, attachments, model
   * 2. Inject Sampling_Params defaults for missing fields
   * 3. Rewrite response_format (json_object -> grammar injection)
   * 4. Validate sampling fields
   * 5. Check tool support
   * 6. Route via selectSlot
   * 7. Proxy to upstream slot
   *
   * Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 11.1, 11.2, 11.3, 11.4, 13.2, 13.3, 13.4, 14.3, 14.4
   *
   * @private
   */
  async _handleChatCompletions(req, res) {
    try {
      let body = await this._parseBody(req);

      // Extract request components
      const messages = body.messages || [];
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

      // Get slots
      const slots = this.slotManager.listSlots();

      // Select the target slot
      const slot = selectSlot(lastUserMessageText, attachments, requestedModel, slots);

      if (!slot) {
        // Synchronously write 503 before any logging/metrics (Req 6.4)
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_model_slot_available' }));
        // Best-effort logging in queueMicrotask
        queueMicrotask(() => {
          this.logger.warn('[ApiGateway] No model slot available for request');
        });
        return;
      }

      // Apply sampling defaults (returns a new object with deep copy)
      const modelConfig = this.slotManager.modelConfigStore && this.slotManager.modelConfigStore.getOrDefault(slot.modelPath);
      body = this._applySamplingDefaults(body, modelConfig);

      // Validate sampling parameters
      const samplingValidation = this._validateSamplingParams(body);
      if (!samplingValidation.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'invalid_sampling_params',
          field: samplingValidation.field,
        }));
        return;
      }

      // Handle response_format rewriting
      if (body.response_format) {
        if (body.response_format.type === 'json_object') {
          try {
            body.grammar = this.grammarLibrary.get('json-object');
            delete body.response_format;
          } catch (err) {
            this.logger.warn('[ApiGateway] Failed to load json-object grammar:', err.message);
            // Forward unchanged per Req 13.3
          }
        } else if (body.response_format.type === 'json_schema') {
          // Preserve json_schema unchanged per Req 13.4
          // (llama-server will handle it via json_schema field)
        }
      }

      // Check tool support
      if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
        if (!slot.supportsTools) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'model_does_not_support_tools',
            slotId: slot.id,
            model: slot.modelPath,
          }));
          return;
        }
      }

      // Proxy to upstream slot
      await this._proxyRequest(req, res, slot, body);
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleChatCompletions:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /v1/completions requests
   *
   * Similar to chat completions but for the completions endpoint.
   *
   * @private
   */
  async _handleCompletions(req, res) {
    try {
      const body = await this._parseBody(req);
      const requestedModel = body.model || '';
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';

      const slots = this.slotManager.listSlots();
      const slot = selectSlot(prompt, [], requestedModel, slots);

      if (!slot) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_model_slot_available' }));
        return;
      }

      await this._proxyRequest(req, res, slot, body);
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleCompletions:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /v1/embeddings requests
   *
   * Routes fixedly to embedding slot (id 3).
   *
   * Requirements: 16.3, 16.4
   *
   * @private
   */
  async _handleEmbeddings(req, res) {
    try {
      const embeddingSlot = this.slotManager.getSlot(3);

      if (!embeddingSlot || embeddingSlot.status !== 'running') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'embedding_slot_not_running' }));
        return;
      }

      const body = await this._parseBody(req);
      await this._proxyRequest(req, res, embeddingSlot, body);
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleEmbeddings:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /v1/models requests
   *
   * Fan-out to all active slots and aggregate results.
   *
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 19.2
   *
   * @private
   */
  async _handleModels(req, res) {
    try {
      const activeSlots = this.slotManager.getActiveSlots();

      // Req 19.2: Return 503 when no slot is running
      if (activeSlots.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'no_slot_running',
          hint: 'open Settings and start at least one slot',
        }));
        return;
      }

      const allModels = [];
      const seenIds = new Set();

      // Fan-out to each active slot with 2s timeout
      const promises = activeSlots.map(slot =>
        this._fetchSlotModels(slot).catch(err => {
          this.logger.warn('[ApiGateway] Failed to fetch models from slot ' + slot.id + ':', err.message);
          return [];
        })
      );

      const results = await Promise.all(promises);

      // Aggregate and deduplicate
      for (let i = 0; i < results.length; i++) {
        const slot = activeSlots[i];
        const models = results[i];

        for (const model of models) {
          if (!seenIds.has(model.id)) {
            seenIds.add(model.id);
            allModels.push({
              ...model,
              owned_by: 'slot-' + slot.id,
              slot_id: slot.id,
              slot_purpose: slot.purpose,
              port: slot.port,
            });
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: allModels,
      }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleModels:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Fetch models from a single slot with timeout
   * @private
   */
  async _fetchSlotModels(slot) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 2000);

      const url = 'http://127.0.0.1:' + slot.port + '/v1/models';
      http.get(url, (res) => {
        clearTimeout(timeout);
        let data = '';

        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            resolve(body.data || []);
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Handle /v1/slots/status requests
   *
   * Returns status of all 5 slots from in-process state only.
   * No upstream HTTP calls.
   *
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
   *
   * @private
   */
  async _handleSlotsStatus(req, res) {
    try {
      const slots = this.slotManager.listSlots();
      const slotsStatus = slots.map(slot => ({
        id: slot.id,
        port: slot.port,
        purpose: slot.purpose,
        status: slot.status,
        modelPath: slot.status === 'running' ? slot.modelPath : null,
        mmprojPath: slot.status === 'running' ? slot.mmprojPath : null,
        lastUsed: slot.lastUsed,
        metrics: slot.metrics || {
          tokensGenerated: 0,
          tokensPrompted: 0,
          requestsServed: 0,
          avgLatencyMs: 0,
        },
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ slots: slotsStatus }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleSlotsStatus:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /tokenize requests
   *
   * Routes fixedly to primary slot (id 0).
   *
   * Requirements: 17.1, 17.2, 17.3
   *
   * @private
   */
  async _handleTokenize(req, res) {
    try {
      const primarySlot = this.slotManager.getSlot(0);

      if (!primarySlot || primarySlot.status !== 'running') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'primary_slot_not_running' }));
        return;
      }

      const body = await this._parseBody(req);
      await this._proxyRequest(req, res, primarySlot, body);
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleTokenize:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /detokenize requests
   *
   * Routes fixedly to primary slot (id 0).
   *
   * Requirements: 17.1, 17.2, 17.3
   *
   * @private
   */
  async _handleDetokenize(req, res) {
    try {
      const primarySlot = this.slotManager.getSlot(0);

      if (!primarySlot || primarySlot.status !== 'running') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'primary_slot_not_running' }));
        return;
      }

      const body = await this._parseBody(req);
      await this._proxyRequest(req, res, primarySlot, body);
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleDetokenize:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Handle /health requests
   *
   * Always returns 200 with gateway status.
   * Must never return 5xx.
   *
   * Requirements: 18.1, 18.5
   *
   * @private
   */
  async _handleHealth(req, res) {
    try {
      const activeSlots = this.slotManager.getActiveSlots();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        gateway: 'up',
        activeSlots: activeSlots.length,
      }));
    } catch (err) {
      // Even on error, return 200 per Req 18.5
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        gateway: 'up',
        activeSlots: 0,
      }));
    }
  }

  /**
   * Handle /metrics requests
   *
   * Fan-out to all active slots and aggregate metrics.
   *
   * Requirements: 18.2, 19.2
   *
   * @private
   */
  async _handleMetrics(req, res) {
    try {
      const activeSlots = this.slotManager.getActiveSlots();

      // Req 19.2: Return 503 when no slot is running
      if (activeSlots.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'no_slot_running',
          hint: 'open Settings and start at least one slot',
        }));
        return;
      }

      const aggregated = {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      };

      // Fan-out with 2s timeout
      const promises = activeSlots.map(slot =>
        this._fetchSlotMetrics(slot).catch(err => {
          this.logger.warn('[ApiGateway] Failed to fetch metrics from slot ' + slot.id + ':', err.message);
          return null;
        })
      );

      const results = await Promise.all(promises);

      // Aggregate
      let totalLatency = 0;
      let latencyCount = 0;

      for (const metrics of results) {
        if (metrics) {
          aggregated.tokensGenerated += metrics.tokensGenerated || 0;
          aggregated.tokensPrompted += metrics.tokensPrompted || 0;
          aggregated.requestsServed += metrics.requestsServed || 0;
          if (metrics.avgLatencyMs) {
            totalLatency += metrics.avgLatencyMs;
            latencyCount++;
          }
        }
      }

      if (latencyCount > 0) {
        aggregated.avgLatencyMs = totalLatency / latencyCount;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(aggregated));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleMetrics:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Fetch metrics from a single slot with timeout
   * @private
   */
  async _fetchSlotMetrics(slot) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 2000);

      const url = 'http://127.0.0.1:' + slot.port + '/metrics';
      http.get(url, (res) => {
        clearTimeout(timeout);
        let data = '';

        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const metrics = JSON.parse(data);
            resolve(metrics);
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Handle /props requests
   *
   * Fan-out to all active slots and aggregate properties.
   *
   * Requirements: 18.3, 19.2
   *
   * @private
   */
  async _handleProps(req, res) {
    try {
      const activeSlots = this.slotManager.getActiveSlots();

      // Req 19.2: Return 503 when no slot is running
      if (activeSlots.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'no_slot_running',
          hint: 'open Settings and start at least one slot',
        }));
        return;
      }

      const allProps = [];

      // Fan-out with 2s timeout
      const promises = activeSlots.map(slot =>
        this._fetchSlotProps(slot).catch(err => {
          this.logger.warn('[ApiGateway] Failed to fetch props from slot ' + slot.id + ':', err.message);
          return null;
        })
      );

      const results = await Promise.all(promises);

      // Aggregate with annotations
      for (let i = 0; i < results.length; i++) {
        const slot = activeSlots[i];
        const props = results[i];

        if (props) {
          // Inject modalities based on whether the slot has an mmproj (vision projector)
          // loaded. llama-server's native /props may not include this field on all
          // versions, so the gateway fills it in from the slot configuration.
          if (!props.modalities) {
            props.modalities = {
              vision: !!(slot.mmprojPath && slot.status === 'running'),
              audio: false,
            };
          }
          allProps.push({
            ...props,
            slotId: slot.id,
            purpose: slot.purpose,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ props: allProps }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleProps:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_server_error' }));
    }
  }

  /**
   * Fetch props from a single slot with timeout
   * @private
   */
  async _fetchSlotProps(slot) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 2000);

      const url = 'http://127.0.0.1:' + slot.port + '/props';
      http.get(url, (res) => {
        clearTimeout(timeout);
        let data = '';

        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const props = JSON.parse(data);
            resolve(props);
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Proxy a request to an upstream slot
   *
   * Forwards the request to the slot's HTTP server and pipes the response back.
   * Handles streaming responses, tool rewriting, client disconnects, and error mapping.
   *
   * Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 13.7
   *
   * @private
   */
  async _proxyRequest(req, res, slot, body) {
    const upstreamUrl = 'http://127.0.0.1:' + slot.port + req.url;

    // Serialize the (possibly modified) body and update Content-Length to match.
    // The body may have been modified by _applySamplingDefaults() or grammar injection,
    // so the original Content-Length from the client header is stale. Sending a
    // mismatched Content-Length causes the upstream to read truncated JSON → 500.
    const bodyStr = JSON.stringify(body);
    const bodyBuf = Buffer.byteLength(bodyStr, 'utf8');

    // Create upstream request with cloned headers (minus Host)
    const upstreamHeaders = { ...req.headers };
    delete upstreamHeaders.host;
    upstreamHeaders['Content-Type'] = 'application/json';
    upstreamHeaders['Content-Length'] = bodyBuf;

    const upstreamReq = http.request(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
    }, (upstreamRes) => {
      // Check for upstream errors
      if (upstreamRes.statusCode >= 500) {
        // Upstream 5xx error
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'upstream_slot_failed',
          slotId: slot.id,
          upstreamStatus: upstreamRes.statusCode,
        }));
        return;
      }

      if (upstreamRes.statusCode === 400) {
        // Check if this is a grammar-parse error
        let bodyData = '';
        upstreamRes.on('data', chunk => { bodyData += chunk; });
        upstreamRes.on('end', () => {
          try {
            const upstreamBody = JSON.parse(bodyData);
            // Check for grammar-parse error signature
            if (upstreamBody.error && typeof upstreamBody.error === 'string' &&
                upstreamBody.error.toLowerCase().includes('grammar')) {
              // Extract line/column if available
              let detail = 'Grammar parsing failed';
              if (upstreamBody.error.includes('line') || upstreamBody.error.includes('column')) {
                detail = upstreamBody.error;
              }
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'invalid_custom_grammar',
                detail: detail,
                upstream: upstreamBody,
              }));
              return;
            }
            // Not a grammar error, forward as-is
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            res.end(bodyData);
          } catch (err) {
            // Failed to parse, forward as-is
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            res.end(bodyData);
          }
        });
        return;
      }

      // For successful responses, check if we need to apply tool rewriting
      const isStreaming = upstreamRes.headers['content-type'] &&
                         upstreamRes.headers['content-type'].includes('text/event-stream');

      // Clone headers for response
      const responseHeaders = { ...upstreamRes.headers };

      if (isStreaming && req.url.includes('/v1/chat/completions')) {
        // Apply tool rewriting to streaming responses
        res.writeHead(upstreamRes.statusCode, responseHeaders);
        pipeline(
          upstreamRes,
          new ToolRewriterStream({ logger: this.logger }),
          res,
          (err) => {
            if (err && err.code !== 'ERR_STREAM_DESTROYED') {
              this.logger.error('[ApiGateway] Streaming pipeline error:', err);
            }
          }
        );
      } else {
        // For non-streaming responses, collect body and apply rewriting if needed
        let responseBody = '';
        upstreamRes.on('data', chunk => { responseBody += chunk; });
        upstreamRes.on('end', () => {
          try {
            // For chat completions, apply tool rewriting
            if (req.url.includes('/v1/chat/completions')) {
              const { rewriteNonStreaming } = require('./tool-rewriter');
              const rewrittenBody = rewriteNonStreaming(Buffer.from(responseBody, 'utf8'));
              res.writeHead(upstreamRes.statusCode, responseHeaders);
              res.end(rewrittenBody);
            } else {
              // For other endpoints, forward byte-identically
              res.writeHead(upstreamRes.statusCode, responseHeaders);
              res.end(responseBody);
            }
          } catch (err) {
            this.logger.error('[ApiGateway] Error processing response:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal_server_error' }));
          }
        });
      }
    });

    // Handle upstream request errors (network errors, connection refused, etc.)
    upstreamReq.on('error', (err) => {
      this.logger.error('[ApiGateway] Upstream request error:', err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'upstream_slot_failed',
        slotId: slot.id,
        upstreamStatus: 0,
      }));
    });

    // Handle client disconnect with 2s guard timer (Req 6.6)
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
      upstreamReq.destroy();
    });

    // Guard timer to ensure cleanup
    const guardTimer = setTimeout(() => {
      if (clientDisconnected && !upstreamReq.destroyed) {
        upstreamReq.destroy();
      }
    }, 2000);

    upstreamReq.on('close', () => {
      clearTimeout(guardTimer);
    });

    // Send body (use pre-serialized string matching the Content-Length header)
    upstreamReq.end(bodyStr);
  }

  /**
   * Drain and close the gateway
   *
   * Stops accepting new connections, waits for in-flight responses to complete,
   * then resolves. Used during app shutdown.
   *
   * Requirements: 5.5
   *
   * @param {Object} options - Options
   * @param {number} options.timeoutMs - Maximum time to wait (default: 10000)
   * @returns {Promise<void>}
   */
  async drainAndClose({ timeoutMs = 10000 } = {}) {
    if (!this.server) return;

    this.isShuttingDown = true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force close pending sockets
        this.server.close();
        resolve();
      }, timeoutMs);

      this.server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Handle POST /v1/images/generations
   *
   * OpenAI-compatible image generation endpoint. Proxies to the desktop's
   * ImageService (sd.cpp / Bonsai Image 4B) via the global.imageService
   * instance. Returns a JSON response with a base64-encoded image.
   *
   * Request body (OpenAI shape):
   *   { prompt: string, n?: number, size?: string, response_format?: "b64_json"|"url" }
   *
   * Extended params (sd.cpp-specific, passed through):
   *   { negative_prompt?, width?, height?, steps?, cfg_scale?, sampling_method?, seed? }
   */
  async _handleImageGenerations(req, res) {
    try {
      if (!global.imageService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Image service not initialized', type: 'service_unavailable', code: 503 } }));
        return;
      }

      const body = await this._parseBody(req);
      const prompt = body.prompt;
      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }));
        return;
      }

      // Parse OpenAI-style "size" (e.g. "512x512") into width/height
      let width = body.width || 512;
      let height = body.height || 512;
      if (body.size && typeof body.size === 'string') {
        const m = body.size.match(/^(\d+)x(\d+)$/);
        if (m) { width = parseInt(m[1]); height = parseInt(m[2]); }
      }

      const params = {
        prompt,
        negativePrompt: body.negative_prompt || body.negativePrompt,
        width,
        height,
        steps: body.steps,
        cfgScale: body.cfg_scale || body.cfgScale,
        samplingMethod: body.sampling_method || body.samplingMethod,
        seed: body.seed,
        b64: true // Always return base64 for the HTTP endpoint
      };

      const result = await global.imageService.generateImage(params);
      if (result.success && result.b64) {
        // Return OpenAI-compatible response
        const response = {
          created: Math.floor(Date.now() / 1000),
          data: [{
            b64_json: result.b64,
            revised_prompt: prompt
          }]
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } else {
        const errMsg = result.error || 'Image generation failed';
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: errMsg, type: 'image_generation_error', code: 500 } }));
      }
    } catch (err) {
      this.logger.error('[Gateway] Image generation error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message, type: 'internal_error', code: 500 } }));
    }
  }

  /**
   * Handle GET /v1/images/status
   *
   * Returns the current status of the image service (ready, sd-cli path,
   * model info). Useful for clients to check if image generation is available.
   */
  _handleImageStatus(req, res) {
    try {
      if (!global.imageService) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Image service not initialized', type: 'service_unavailable', code: 503 } }));
        return;
      }
      const status = global.imageService.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: status.ready, sdCliPath: status.sdCliPath, model: status.imageModel }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message, type: 'internal_error', code: 500 } }));
    }
  }

  // ===========================================================================
  // Desktop model management endpoints
  //
  // These mirror the Electron IPC handlers in main.js so the webui can manage
  // models via HTTP when not running inside Electron (e.g. the standalone
  // webui used for UI testing). When desktopServices is not configured, all
  // handlers return 503 with a clear error message.
  // ===========================================================================

  /**
   * Check that desktopServices is available. Returns true if available,
   * otherwise sends a 503 response and returns false.
   * @private
   */
  _requireDesktopServices(res) {
    if (this.desktopServices) return true;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'desktop_services_unavailable',
      hint: 'Model management is only available when the desktop backend is running.',
    }));
    return false;
  }

  /**
   * Handle GET /v1/desktop/installed-models
   *
   * Returns the list of installed GGUF models on disk, excluding mmproj
   * (vision projector) files. Mirrors the 'get-installed-models' IPC handler.
   */
  async _handleGetInstalledModels(req, res) {
    if (!this._requireDesktopServices(res)) return;
    try {
      const models = await this.desktopServices.getInstalledModels();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleGetInstalledModels:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * Handle POST /v1/desktop/huggingface/search
   *
   * Body: { repoId: string, hfToken?: string }
   * Returns: { modelFiles: [...], mmprojFiles: [...], hasVisionSupport: bool }
   *
   * Mirrors the 'search-huggingface' IPC handler.
   */
  async _handleHuggingFaceSearch(req, res) {
    if (!this._requireDesktopServices(res)) return;
    try {
      const body = await this._parseBody(req);
      const repoId = body.repoId;
      const hfToken = body.hfToken;
      if (!repoId || typeof repoId !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'repoId is required' }));
        return;
      }
      const result = await this.desktopServices.searchHuggingFaceRepo(repoId, hfToken);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleHuggingFaceSearch:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * Handle POST /v1/desktop/huggingface/download
   *
   * Body: { repoId: string, filename: string, hfToken?: string }
   * Returns: { downloadId: string, started: true }
   *
   * The download runs in the background; poll progress via
   * GET /v1/desktop/download-progress?downloadId=...
   *
   * Mirrors the 'download-huggingface-model' IPC handler.
   */
  async _handleHuggingFaceDownload(req, res) {
    if (!this._requireDesktopServices(res)) return;
    try {
      const body = await this._parseBody(req);
      const repoId = body.repoId;
      const filename = body.filename;
      const hfToken = body.hfToken;
      if (!repoId || !filename) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'repoId and filename are required' }));
        return;
      }
      const cleanRepoId = String(repoId)
        .replace(/^https?:\/\/huggingface\.co\//, '')
        .replace(/\/$/, '')
        .trim();
      const downloadId = `${cleanRepoId}/${filename}`;
      // Start download in background — progress is polled separately
      this.desktopServices.downloadHuggingFaceModel(repoId, filename, hfToken).catch((err) => {
        this.logger.error('[ApiGateway] Background download failed:', err);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ downloadId, started: true }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleHuggingFaceDownload:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * Handle GET /v1/desktop/download-progress?downloadId=...
   *
   * Returns: { progress: number (0-1), status: string, filename?: string }
   *
   * Mirrors the 'get-download-progress' IPC handler.
   */
  async _handleGetDownloadProgress(req, res) {
    if (!this._requireDesktopServices(res)) return;
    try {
      const url = new URL(req.url, 'http://127.0.0.1:13439');
      const downloadId = url.searchParams.get('downloadId');
      if (!downloadId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'downloadId query parameter is required' }));
        return;
      }
      const progress = this.desktopServices.getDownloadProgress(downloadId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(progress || { progress: 0, status: 'unknown' }));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleGetDownloadProgress:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * Handle POST /v1/desktop/models/delete
   *
   * Body: { filename: string }
   * Returns: { success: boolean, error?: string }
   *
   * Mirrors the 'delete-model' IPC handler.
   */
  async _handleDeleteModel(req, res) {
    if (!this._requireDesktopServices(res)) return;
    try {
      const body = await this._parseBody(req);
      const filename = body.filename;
      if (!filename || typeof filename !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'filename is required' }));
        return;
      }
      const result = await this.desktopServices.deleteModel(filename);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.logger.error('[ApiGateway] Error in _handleDeleteModel:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

module.exports = {
  ApiGateway,
  GatewayBindError,
};