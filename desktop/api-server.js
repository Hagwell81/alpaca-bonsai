/* eslint-env node */
const Store = require('electron-store');
const store = new Store();

const DEFAULT_API_CONFIG = {
  // Basic settings
  enabled: true,
  host: '127.0.0.1',
  port: 13434,
  cors: true,
  
  // Timeout & concurrency
  requestTimeout: 300000, // 5 minutes for long generations
  maxConcurrentRequests: 10,
  
  // Circuit breaker settings
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5, // fail after 5 consecutive errors
  circuitBreakerResetMs: 60000, // reset after 1 minute
  
  // Heartbeat for streaming
  streamHeartbeatIntervalMs: 30000, // 30 seconds
  
  // Security
  requireApiKey: false,
  apiKey: null,
  corsOrigins: ['*'], // Restrict in production
  
  // Monitoring
  logLevel: 'info',
  metricsEnabled: false,
};

// API key cache for performance
const apiKeyCache = {
  value: null,
  timestamp: null,
  ttlMs: 3600000, // 1 hour cache TTL
  
  /**
   * Get cached API key if still valid
   * @returns {string|null} Cached API key or null if expired
   */
  get() {
    if (!this.value || !this.timestamp) {
      return null;
    }
    const age = Date.now() - this.timestamp;
    if (age > this.ttlMs) {
      this.clear();
      return null;
    }
    return this.value;
  },
  
  /**
   * Set cached API key
   * @param {string} value - API key to cache
   */
  set(value) {
    this.value = value;
    this.timestamp = Date.now();
  },
  
  /**
   * Clear cached API key
   */
  clear() {
    this.value = null;
    this.timestamp = null;
  }
};

function getApiConfig() {
  const stored = store.get('apiServer', DEFAULT_API_CONFIG);
  // Merge with defaults to ensure all fields exist (backward compatibility)
  return { ...DEFAULT_API_CONFIG, ...stored };
}

function setApiConfig(config) {
  const current = getApiConfig();
  const merged = { ...current, ...config };
  
  // Validate
  if (merged.port && (merged.port < 1024 || merged.port > 65535)) {
    throw new Error('Port must be between 1024 and 65535');
  }
  if (merged.host && typeof merged.host !== 'string') {
    throw new Error('Host must be a string');
  }
  if (merged.requestTimeout && merged.requestTimeout < 1000) {
    throw new Error('Request timeout must be at least 1000ms');
  }
  if (merged.maxConcurrentRequests && merged.maxConcurrentRequests < 1) {
    throw new Error('Max concurrent requests must be at least 1');
  }
  if (merged.circuitBreakerThreshold && merged.circuitBreakerThreshold < 1) {
    throw new Error('Circuit breaker threshold must be at least 1');
  }
  if (merged.circuitBreakerResetMs && merged.circuitBreakerResetMs < 1000) {
    throw new Error('Circuit breaker reset time must be at least 1000ms');
  }
  if (merged.streamHeartbeatIntervalMs && merged.streamHeartbeatIntervalMs < 5000) {
    throw new Error('Stream heartbeat interval must be at least 5000ms');
  }
  
  store.set('apiServer', merged);
  return merged;
}

function getApiUrl() {
  const cfg = getApiConfig();
  if (!cfg.enabled) return null;
  return `http://${cfg.host}:${cfg.port}`;
}

function getApiOpenAIEndpoint() {
  const url = getApiUrl();
  if (!url) return null;
  return `${url}/v1`;
}

function getServerArgs() {
  const cfg = getApiConfig();
  const args = [
    '--host', cfg.host || '127.0.0.1',
    '--port', String(cfg.port || 13434),
  ];

  // CORS: upstream llama-server (b9016+) no longer accepts the `--cors`
  // boolean flag and crashes on startup with "invalid argument: --cors".
  // The server is bound to 127.0.0.1 and the Electron renderer loads the
  // UI from the same origin, so no CORS configuration is required for
  // the default configuration. We intentionally do not forward any CORS
  // args to the binary. If the user has explicitly configured origins in
  // settings, emit a one-time warning so they know it is a no-op until
  // upstream support is reintroduced.
  if (cfg.cors && Array.isArray(cfg.corsOrigins) && cfg.corsOrigins.some(o => o && o !== '*')) {
    console.warn('[api-server] Custom CORS origins configured but current llama-server build does not accept CORS flags; ignoring. Server binds to 127.0.0.1 only.');
  }

  // Note: API key is retrieved asynchronously via getApiKeyAsync()
  // This function returns sync args only. API key should be added
  // by the caller after awaiting getApiKeyAsync().

  return args;
}

/**
 * Get API key from Secret_Vault or plain config
 * 
 * Attempts to retrieve the API key from Secret_Vault first (encrypted storage),
 * then falls back to plain config if vault is not available or key not found.
 * 
 * Uses caching to avoid repeated decryption operations for performance.
 * Cache TTL is 1 hour by default.
 * 
 * @returns {Promise<string|null>} API key or null if not found
 * @throws {Error} If Secret_Vault retrieval fails (not caught, propagated to caller)
 */
async function getApiKeyAsync() {
  const cfg = getApiConfig();
  
  if (!cfg.requireApiKey) {
    console.log('[api-server] API key not required');
    return null;
  }

  // Check cache first
  const cachedKey = apiKeyCache.get();
  if (cachedKey) {
    console.log('[api-server] Retrieved API key from cache');
    return cachedKey;
  }

  // Try to get from Secret_Vault first
  if (global.secretVault) {
    try {
      const apiKey = await global.secretVault.getSecret('api_key');
      if (apiKey) {
        console.log('[api-server] Retrieved API key from Secret_Vault');
        apiKeyCache.set(apiKey);
        return apiKey;
      }
    } catch (err) {
      if (err.name === 'SecretNotFoundError') {
        console.log('[api-server] API key not found in Secret_Vault, checking plain config');
      } else if (err.name === 'TokenExpiredError') {
        console.warn('[api-server] API key token has expired in Secret_Vault');
        // Continue to fallback
      } else if (err.name === 'DecryptionFailedError') {
        console.error('[api-server] Failed to decrypt API key from Secret_Vault:', err.message);
        // This could indicate cross-machine copy or corruption
        // Continue to fallback but log warning
      } else {
        console.warn('[api-server] Failed to retrieve API key from Secret_Vault:', err.message);
      }
    }
  } else {
    console.log('[api-server] Secret_Vault not available, using plain config');
  }

  // Fall back to plain config
  if (cfg.apiKey) {
    console.log('[api-server] Using API key from plain config (not encrypted)');
    apiKeyCache.set(cfg.apiKey);
    return cfg.apiKey;
  }

  console.warn('[api-server] No API key found in Secret_Vault or plain config');
  return null;
}

function validateApiKey(providedKey) {
  const cfg = getApiConfig();
  if (!cfg.requireApiKey) return true;
  if (!cfg.apiKey) return true; // No key configured, skip validation
  return providedKey === cfg.apiKey;
}

/**
 * Store API key in Secret_Vault
 * 
 * Stores the API key in the Secret_Vault for encrypted storage.
 * Falls back to plain config if Secret_Vault is not available.
 * 
 * @param {string} apiKey - API key to store
 * @returns {Promise<void>}
 * @throws {Error} If Secret_Vault storage fails
 */
async function storeApiKeyAsync(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('API key must be a non-empty string');
  }

  // Try to store in Secret_Vault first
  if (global.secretVault) {
    try {
      await global.secretVault.setSecret('api_key', apiKey);
      console.log('[api-server] Stored API key in Secret_Vault');
      apiKeyCache.set(apiKey);
      return;
    } catch (err) {
      console.warn('[api-server] Failed to store API key in Secret_Vault:', err.message);
      // Continue to fallback
    }
  }

  // Fall back to plain config
  console.log('[api-server] Storing API key in plain config (not encrypted)');
  setApiConfig({ apiKey });
  apiKeyCache.set(apiKey);
}

/**
 * Clear cached API key
 * 
 * Clears the in-memory cache of the API key. Useful when the key
 * is updated or needs to be re-fetched from storage.
 * 
 * @returns {void}
 */
function clearApiKeyCache() {
  apiKeyCache.clear();
  console.log('[api-server] Cleared API key cache');
}

module.exports = {
  getApiConfig,
  setApiConfig,
  getApiUrl,
  getApiOpenAIEndpoint,
  getServerArgs,
  getApiKeyAsync,
  storeApiKeyAsync,
  clearApiKeyCache,
  validateApiKey,
  DEFAULT_API_CONFIG,
};
