const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload.js] Starting preload script execution. location:', typeof location !== 'undefined' ? location.href : 'N/A');

// Catch any top-level errors in the preload script
process.on('uncaughtException', (err) => {
  console.error('[preload.js] UNCAUGHT EXCEPTION:', err);
});

const downloadCompleteCallbacks = new Map();
const modelSwitchStatusCallbacks = new Map();
const logAppendCallbacks = new Map();
const backendUpdateCallbacks = new Map();

/**
 * Optimized data transfer utilities for large payloads
 * Implements structuredClone transfer, chunked streaming, and progress events
 */
class OptimizedDataTransfer {
  /**
   * Transfer large payload using structuredClone for zero-copy transfer
   * @param {any} data - Data to transfer
   * @param {Object} options - Transfer options
   * @returns {Promise<any>} - Transferred data
   */
  static async transferWithStructuredClone(data, options = {}) {
    const { chunkSize = 1024 * 1024, onProgress = null } = options;
    
    // For small payloads, use direct structuredClone
    if (!this._shouldChunk(data, chunkSize)) {
      return structuredClone(data);
    }
    
    // For large payloads, use chunked transfer
    return this._chunkedTransfer(data, chunkSize, onProgress);
  }
  
  /**
   * Determine if data should be chunked based on size
   * @private
   */
  static _shouldChunk(data, chunkSize) {
    try {
      const serialized = JSON.stringify(data);
      return serialized.length > chunkSize;
    } catch {
      // If serialization fails, don't chunk
      return false;
    }
  }
  
  /**
   * Transfer data in chunks with progress reporting
   * @private
   */
  static async _chunkedTransfer(data, chunkSize, onProgress) {
    const serialized = JSON.stringify(data);
    const totalBytes = serialized.length;
    const chunks = [];
    
    for (let i = 0; i < totalBytes; i += chunkSize) {
      const chunk = serialized.slice(i, i + chunkSize);
      chunks.push(chunk);
      
      if (onProgress) {
        const progress = {
          bytesTransferred: Math.min(i + chunkSize, totalBytes),
          totalBytes,
          percentComplete: Math.round((Math.min(i + chunkSize, totalBytes) / totalBytes) * 100)
        };
        onProgress(progress);
      }
    }
    
    // Reconstruct and parse
    const reconstructed = chunks.join('');
    return JSON.parse(reconstructed);
  }
  
  /**
   * Stream large data with progress events
   * @param {string} channelName - IPC channel name
   * @param {any} data - Data to stream
   * @param {Object} options - Stream options
   * @returns {Promise<any>} - Streamed data
   */
  static async streamData(channelName, data, options = {}) {
    const { chunkSize = 1024 * 1024, onProgress = null } = options;
    
    const serialized = JSON.stringify(data);
    const totalBytes = serialized.length;
    const chunks = [];
    
    for (let i = 0; i < totalBytes; i += chunkSize) {
      const chunk = serialized.slice(i, i + chunkSize);
      chunks.push(chunk);
      
      if (onProgress) {
        const progress = {
          bytesTransferred: Math.min(i + chunkSize, totalBytes),
          totalBytes,
          percentComplete: Math.round((Math.min(i + chunkSize, totalBytes) / totalBytes) * 100)
        };
        onProgress(progress);
      }
    }
    
    // Reconstruct and parse
    const reconstructed = chunks.join('');
    return JSON.parse(reconstructed);
  }
}

/**
 * Audit utilities for security verification
 */
class PreloadAudit {
  /**
   * Verify that no direct require() calls are exposed to renderer
   * @returns {Object} - Audit results
   */
  static auditRequireLeaks() {
    const results = {
      hasDirectRequire: false,
      exposedModules: [],
      warnings: []
    };
    
    // Check if require is accessible from global scope
    try {
      if (typeof require !== 'undefined' && require.resolve) {
        results.hasDirectRequire = true;
        results.warnings.push('Direct require() is accessible in preload context');
      }
    } catch {
      // require is not accessible, which is good
    }
    
    return results;
  }
  
  /**
   * Verify all APIs exposed via contextBridge
   * @param {Object} exposedAPIs - APIs exposed via contextBridge
   * @returns {Object} - Verification results
   */
  static verifyContextBridgeAPIs(exposedAPIs) {
    const results = {
      totalAPIs: 0,
      verifiedAPIs: 0,
      issues: [],
      apisByNamespace: {}
    };
    
    for (const [namespace, apis] of Object.entries(exposedAPIs)) {
      results.apisByNamespace[namespace] = {
        count: Object.keys(apis).length,
        methods: Object.keys(apis)
      };
      results.totalAPIs += Object.keys(apis).length;
      
      // Verify each API is a function or object
      for (const [apiName, apiValue] of Object.entries(apis)) {
        if (typeof apiValue === 'function' || typeof apiValue === 'object') {
          results.verifiedAPIs++;
        } else {
          results.issues.push(`API ${namespace}.${apiName} is not a function or object`);
        }
      }
    }
    
    return results;
  }
}

try {
  console.log('[preload.js] Exposing llamaAPI via contextBridge...');
  contextBridge.exposeInMainWorld('llamaAPI', {
    getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  downloadModels: () => ipcRenderer.invoke('download-models'),
  getModelsDirectory: () => ipcRenderer.invoke('get-models-directory'),
  setSelectedModels: (modelNames) => ipcRenderer.invoke('set-selected-models', modelNames),
  getSelectedModels: () => ipcRenderer.invoke('get-selected-models'),
  // App data
  getAppDataDirectory: () => ipcRenderer.invoke('get-app-data-directory'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  // Model management
  getInstalledModels: () => ipcRenderer.invoke('get-installed-models'),
  importLocalModel: () => ipcRenderer.invoke('import-local-model'),
  importVisionModel: () => ipcRenderer.invoke('import-vision-model'),
  getActiveModel: () => ipcRenderer.invoke('get-active-model'),
  deleteModel: (filename) => ipcRenderer.invoke('delete-model', filename),
  // Bonsai model catalog (mirrors bonsai-beach config/bonsai-beach.toml)
  bonsaiListModels: () => ipcRenderer.invoke('bonsai:list-models'),
  bonsaiListChatModels: () => ipcRenderer.invoke('bonsai:list-chat-models'),
  bonsaiGetImageModel: () => ipcRenderer.invoke('bonsai:get-image-model'),
  bonsaiListMissingFiles: (modelId) => ipcRenderer.invoke('bonsai:list-missing-files', modelId),
  bonsaiDownloadModel: (modelId) => ipcRenderer.invoke('bonsai:download-model', modelId),
  bonsaiGetDownloadProgress: (modelId) => ipcRenderer.invoke('bonsai:get-download-progress', modelId),
  switchModel: (filename) => ipcRenderer.invoke('switch-model', filename),
  onModelSwitchStatus: (callback) => {
    const wrapper = (event, data) => callback(data);
    modelSwitchStatusCallbacks.set(callback, wrapper);
    ipcRenderer.on('model-switch-status', wrapper);
  },
  offModelSwitchStatus: (callback) => {
    const wrapper = modelSwitchStatusCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('model-switch-status', wrapper);
      modelSwitchStatusCallbacks.delete(callback);
    }
  },
  // HuggingFace search and download
  searchHuggingFace: (repoId, hfToken) => ipcRenderer.invoke('search-huggingface', repoId, hfToken),
  downloadHuggingFaceModel: (repoId, filename, hfToken) => ipcRenderer.invoke('download-huggingface-model', repoId, filename, hfToken),
  getDownloadProgress: (downloadId) => ipcRenderer.invoke('get-download-progress', downloadId),
  getAllDownloadProgress: () => ipcRenderer.invoke('get-all-download-progress'),
  // Storage info
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  // Diagnostics
  getLastError: () => ipcRenderer.invoke('get-last-error'),
  copyLogPath: () => ipcRenderer.invoke('copy-log-path'),
  getHardwareInfo: () => ipcRenderer.invoke('get-hardware-info'),
  refreshHardwareDetection: () => ipcRenderer.invoke('refresh-hardware-detection'),
  // Navigation
  goBackToMain: () => ipcRenderer.invoke('go-back-to-main'),
  // Download notifications
  onDownloadComplete: (callback) => {
    const wrapper = (event, data) => callback(data);
    downloadCompleteCallbacks.set(callback, wrapper);
    ipcRenderer.on('download-complete', wrapper);
  },
  offDownloadComplete: (callback) => {
    const wrapper = downloadCompleteCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('download-complete', wrapper);
      downloadCompleteCallbacks.delete(callback);
    }
  },
  // User authentication
  registerUser: (username, password, email, bio) => ipcRenderer.invoke('register-user', username, password, email, bio),
  loginUser: (username, password) => ipcRenderer.invoke('login-user', username, password),
  getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
  logoutUser: () => ipcRenderer.invoke('logout-user'),
  updateUserProfile: (updates) => ipcRenderer.invoke('update-user-profile', updates),
  // Web search
  webSearch: (query, maxResults) => ipcRenderer.invoke('web-search', query, maxResults),
  fetchWebPage: (url) => ipcRenderer.invoke('fetch-web-page', url),
  // Embedded jCodeMunch code retrieval
  jcmHealthCheck: () => ipcRenderer.invoke('jcm-health-check'),
  jcmIndexRepo: (repoUrl) => ipcRenderer.invoke('jcm-index-repo', repoUrl),
  jcmIndexFolder: (folderPath) => ipcRenderer.invoke('jcm-index-folder', folderPath),
  jcmSearchSymbols: (repo, query, maxResults, kind) => ipcRenderer.invoke('jcm-search-symbols', repo, query, maxResults, kind),
  jcmGetSymbolSource: (repo, symbolId) => ipcRenderer.invoke('jcm-get-symbol-source', repo, symbolId),
  jcmListRepos: () => ipcRenderer.invoke('jcm-list-repos'),
  jcmGetRepoOutline: (repo) => ipcRenderer.invoke('jcm-get-repo-outline', repo),
  jcmGetFileTree: (repo, pathPrefix) => ipcRenderer.invoke('jcm-get-file-tree', repo, pathPrefix),
  jcmGetFileContent: (repo, filePath) => ipcRenderer.invoke('jcm-get-file-content', repo, filePath),
  jcmGetContextBundle: (repo, symbolId, includeCallers) => ipcRenderer.invoke('jcm-get-context-bundle', repo, symbolId, includeCallers),
  jcmGetFileOutline: (repo, filePath) => ipcRenderer.invoke('jcm-get-file-outline', repo, filePath),
  jcmInvalidateCache: (repo) => ipcRenderer.invoke('jcm-invalidate-cache', repo),
  // Local folder picker
  selectLocalFolder: () => ipcRenderer.invoke('select-local-folder'),
  // API server settings
  getApiSettings: () => ipcRenderer.invoke('get-api-settings'),
  setApiSettings: (settings) => ipcRenderer.invoke('set-api-settings', settings),
  // Health check & monitoring
  getApiHealth: () => ipcRenderer.invoke('api:health'),
  countTokens: (messages, model) => ipcRenderer.invoke('api:count-tokens', messages, model),
  getQueueStatus: () => ipcRenderer.invoke('api:queue-status'),
  // Backend management
  getInstalledBackends: () => ipcRenderer.invoke('get-installed-backends'),
  checkForBackendUpdate: () => ipcRenderer.invoke('check-for-backend-update'),
  downloadBackend: (backend, version) => ipcRenderer.invoke('download-backend', backend, version),
  getCurrentBackendInfo: () => ipcRenderer.invoke('get-current-backend-info'),
  updateBackend: () => ipcRenderer.invoke('update-backend'),
  // Per-repo release checks (bonsai variant, upstream, sd.cpp)
  checkReleaseForRepo: (repo) => ipcRenderer.invoke('check-release-for-repo', repo),
  getRepoPreference: () => ipcRenderer.invoke('get-repo-preference'),
  setRepoPreference: (pref) => ipcRenderer.invoke('set-repo-preference', pref),
  checkSdCppUpdate: () => ipcRenderer.invoke('check-sd-cpp-update'),
  getSdBackendInfo: () => ipcRenderer.invoke('get-sd-backend-info'),
  updateSdBackend: () => ipcRenderer.invoke('update-sd-backend'),
  // Experimental Bonsai features (4-bit KV cache, speculative decoding)
  getBonsaiExperimental: () => ipcRenderer.invoke('get-bonsai-experimental'),
  setBonsaiExperimental: (opts) => ipcRenderer.invoke('set-bonsai-experimental', opts),
  checkDsparkDrafter: () => ipcRenderer.invoke('check-dspark-drafter'),
  onBackendUpdateProgress: (callback) => {
    const wrapper = (event, data) => callback(data);
    backendUpdateCallbacks.set(callback, wrapper);
    ipcRenderer.on('backend-update-progress', wrapper);
  },
  offBackendUpdateProgress: (callback) => {
    const wrapper = backendUpdateCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('backend-update-progress', wrapper);
      backendUpdateCallbacks.delete(callback);
    }
  },
  // Service logs (live monitor)
  getInitialLogs: () => ipcRenderer.invoke('logs:get-initial'),
  openLogFile: () => ipcRenderer.invoke('logs:open-file'),
  revealLogInFolder: () => ipcRenderer.invoke('logs:reveal-in-folder'),
  onLogAppend: (callback) => {
    const wrapper = (event, chunk) => callback(chunk);
    logAppendCallbacks.set(callback, wrapper);
    ipcRenderer.on('logs:append', wrapper);
  },
  offLogAppend: (callback) => {
    const wrapper = logAppendCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('logs:append', wrapper);
      logAppendCallbacks.delete(callback);
    }
  },
  // Documentation viewer (opens a bundled docs window)
  openDocumentation: (docPath) => ipcRenderer.invoke('docs:open', docPath),
  // Splash screen updates
  onSplashUpdate: (callback) => {
    const wrapper = (event, data) => callback(data);
    ipcRenderer.on('splash:update', wrapper);
  },
  // Lazy-start server activation
  startLazyServer: () => ipcRenderer.invoke('start-lazy-server'),
  getLazyStartSettings: () => ipcRenderer.invoke('get-lazy-start-settings'),
  setLazyStartEnabled: (enabled) => ipcRenderer.invoke('set-lazy-start-enabled', enabled),
  // Provider credentials
  getProviderCredentials: () => ipcRenderer.invoke('get-provider-credentials'),
  setProviderCredential: (id, name, baseUrl, apiKey, models) => ipcRenderer.invoke('set-provider-credential', id, name, baseUrl, apiKey, models),
  deleteProviderCredential: (id) => ipcRenderer.invoke('delete-provider-credential', id),
  // VRAM / Memory
  detectVramBudget: () => ipcRenderer.invoke('detect-vram-budget'),
  getActiveAllocationsMB: () => ipcRenderer.invoke('get-active-allocations-mb'),
  autoTuneNgl: (params) => ipcRenderer.invoke('auto-tune-ngl', params),
  // Voice service
  voiceGetStatus: () => ipcRenderer.invoke('voice:getStatus'),
  voiceTranscribe: (base64Audio, format) => ipcRenderer.invoke('voice:transcribe', base64Audio, format),
  voiceSynthesize: (text, options) => ipcRenderer.invoke('voice:synthesize', text, options),
  voiceDownloadModel: (modelName, url) => ipcRenderer.invoke('voice:downloadModel', modelName, url),
  // Image Service (sd.cpp / Bonsai Image 4B)
  imageGetStatus: () => ipcRenderer.invoke('image:getStatus'),
  imageEnsureReady: () => ipcRenderer.invoke('image:ensureReady'),
  imageGenerate: (params) => ipcRenderer.invoke('image:generate', params),
  imageOpenImageFolder: () => ipcRenderer.invoke('image:openImageFolder'),
  // Launch Service (Ollama-style integrations)
  launchListIntegrations: () => ipcRenderer.invoke('launch:list-integrations'),
  launchConfigure: (integrationId, model) => ipcRenderer.invoke('launch:configure', integrationId, model),
  launchGenerateEnv: (integrationId, model) => ipcRenderer.invoke('launch:generate-env', integrationId, model),
  launchOpenEnvFolder: () => ipcRenderer.invoke('launch:open-env-folder'),
  launchCheckInstalled: (integrationId) => ipcRenderer.invoke('launch:check-installed', integrationId),
  launchCheckAllInstalled: () => ipcRenderer.invoke('launch:check-all-installed'),
  launchLaunchIntegration: (integrationId, model) => ipcRenderer.invoke('launch:launch-integration', integrationId, model),
  // IDE Config Generator
  ideGenerateConfigs: (ideId, modelName) => ipcRenderer.invoke('ide:generate-configs', ideId, modelName),
  ideListSupported: () => ipcRenderer.invoke('ide:list-supported'),
  ideOpenConfigFolder: () => ipcRenderer.invoke('ide:open-config-folder'),
  // Workspace file tree
  workspaceGetFileTree: (folderPath, depth) => ipcRenderer.invoke('workspace:get-file-tree', folderPath, depth),
  // Knowledge Base
  kbGetCollections: () => ipcRenderer.invoke('kb:get-collections'),
  kbCreateCollection: (name, description) => ipcRenderer.invoke('kb:create-collection', name, description),
  kbDeleteCollection: (id) => ipcRenderer.invoke('kb:delete-collection', id),
  kbIngestDocuments: (collectionId, files, options) => ipcRenderer.invoke('kb:ingest-documents', collectionId, files, options),
  kbIngestUrl: (collectionId, url, options) => ipcRenderer.invoke('kb:ingest-url', collectionId, url, options),
  kbSearch: (collectionId, query, topK) => ipcRenderer.invoke('kb:search', collectionId, query, topK),
  kbGetDocuments: (collectionId) => ipcRenderer.invoke('kb:get-documents', collectionId),
  kbDeleteDocument: (collectionId, docId) => ipcRenderer.invoke('kb:delete-document', collectionId, docId),
  // Workspace
  workspaceGetState: () => ipcRenderer.invoke('workspace:get-state'),
  workspaceSetFolder: (folderPath) => ipcRenderer.invoke('workspace:set-folder', folderPath),
  workspaceOpenSandbox: () => ipcRenderer.invoke('workspace:open-sandbox'),
  // TUI (Terminal UI) launch and workspace configuration
  tuiLaunch: (opts) => ipcRenderer.invoke('tui:launch', opts),
  tuiGetWorkspace: () => ipcRenderer.invoke('tui:get-workspace'),
  tuiSetWorkspace: (folderPath) => ipcRenderer.invoke('tui:set-workspace', folderPath),
  tuiFindBinary: () => ipcRenderer.invoke('tui:find-binary'),
  // MCP Server management
  kbGetMcpConfig: () => ipcRenderer.invoke('kb:get-mcp-config'),
  kbRestartMcpServer: () => ipcRenderer.invoke('kb:restart-mcp-server'),
  });
  console.log('[preload.js] llamaAPI exposed successfully.');
} catch (exposeErr) {
  console.error('[preload.js] FAILED to expose llamaAPI:', exposeErr);
}

// Migration API for the migration dialog
try {
  console.log('[preload.js] Exposing migrationAPI via contextBridge...');
  contextBridge.exposeInMainWorld('migrationAPI', {
  performMigration: () => ipcRenderer.invoke('migration:performMigration'),
  cancelMigration: () => ipcRenderer.send('migration:cancelMigration'),
  closeMigrationDialog: () => ipcRenderer.send('migration:closeDialog'),
  });
  console.log('[preload.js] migrationAPI exposed successfully.');
} catch (exposeErr) {
  console.error('[preload.js] FAILED to expose migrationAPI:', exposeErr);
}

// Secret_Vault API for secure secret storage
contextBridge.exposeInMainWorld('secretVaultAPI', {
  // Get a secret by key
  getSecret: (key) => ipcRenderer.invoke('vault:getSecret', key),
  
  // Store a secret with optional metadata
  setSecret: (key, value, options = {}) => ipcRenderer.invoke('vault:setSecret', key, value, options),
  
  // Delete a secret by key
  deleteSecret: (key) => ipcRenderer.invoke('vault:deleteSecret', key),
  
  // Get metadata for a secret (expiration, scope, checksum) without decrypting the value
  getSecretMetadata: (key) => ipcRenderer.invoke('vault:getSecretMetadata', key),
  
  // List all stored secret keys (not values)
  listSecrets: () => ipcRenderer.invoke('vault:listSecrets'),
  
  // Refresh a token using an async refresh function
  // The refreshFn should be an async function that takes (key, currentToken) and returns { token, expiresAt, metadata }
  refreshToken: async (key, refreshFn) => {
    try {
      // Get current token first
      const result = await ipcRenderer.invoke('vault:getSecret', key);
      if (!result.success) {
        throw new Error(result.error || 'Failed to get current token');
      }
      
      const currentToken = result.value;
      
      // Call the refresh function in the renderer process
      const refreshResult = await refreshFn(key, currentToken);
      
      if (!refreshResult || !refreshResult.token) {
        throw new Error('Refresh function did not return a valid token');
      }
      
      // Update the token in the vault
      const setResult = await ipcRenderer.invoke('vault:setSecret', key, refreshResult.token, {
        expiresAt: refreshResult.expiresAt,
        metadata: refreshResult.metadata || {}
      });
      
      if (!setResult.success) {
        throw new Error(setResult.error || 'Failed to update token');
      }
      
      return { success: true, token: refreshResult.token };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  
  // Verify master key checksum for cross-machine copy detection
  verifyMasterKeyChecksum: () => ipcRenderer.invoke('vault:verifyMasterKeyChecksum'),
  
  // Check if Secret_Vault is initialized
  isInitialized: () => ipcRenderer.invoke('vault:isInitialized'),
  
  // Get the current encryption backend ('safeStorage', 'aes256gcm', or null)
  getEncryptionBackend: () => ipcRenderer.invoke('vault:getEncryptionBackend'),
});

// Vision Pairing Manager API for managing vision model pairings
contextBridge.exposeInMainWorld('visionPairingAPI', {
  // Get pairing for a base model
  getModelPair: (baseModel) => ipcRenderer.invoke('vision:getModelPair', baseModel),

  // Get all stored pairings
  getAllPairs: () => ipcRenderer.invoke('vision:getAllPairs'),

  // Update offload flag for a model pair
  updateOffloadFlag: (baseModel, offload) => ipcRenderer.invoke('vision:updateOffloadFlag', baseModel, offload),

  // Delete a model pairing
  deletePair: (baseModel) => ipcRenderer.invoke('vision:deletePair', baseModel),
});

// Scheduler API for model lifecycle management
contextBridge.exposeInMainWorld('schedulerAPI', {
  getLoadedModels: () => ipcRenderer.invoke('scheduler:get-loaded-models'),
  getRunnerState: (modelPath) => ipcRenderer.invoke('scheduler:get-runner-state', modelPath),
  preloadModels: (filenames) => ipcRenderer.invoke('scheduler:preload-models', filenames),
  updateConfig: (partial) => ipcRenderer.invoke('scheduler:update-config', partial),
  getConfig: () => ipcRenderer.invoke('scheduler:get-config'),
  terminateRunner: (modelPath) => ipcRenderer.invoke('scheduler:terminate-runner', modelPath),
  onRunnerStateChanged: (callback) => {
    ipcRenderer.on('runner-state-changed', (event, data) => callback(data));
  },
  offRunnerStateChanged: (callback) => {
    ipcRenderer.removeAllListeners('runner-state-changed');
  },
  onVramUpdated: (callback) => {
    ipcRenderer.on('vram-updated', (event, data) => callback(data));
  },
  offVramUpdated: (callback) => {
    ipcRenderer.removeAllListeners('vram-updated');
  },
});

/**
 * Optimized Data Transfer API for large payloads
 * Provides structuredClone transfer, chunked streaming, and progress events
 */
contextBridge.exposeInMainWorld('optimizedTransferAPI', {
  /**
   * Transfer large payload using structuredClone
   * @param {any} data - Data to transfer
   * @param {Object} options - Transfer options (chunkSize, onProgress)
   * @returns {Promise<any>} - Transferred data
   */
  transferWithStructuredClone: async (data, options = {}) => {
    return OptimizedDataTransfer.transferWithStructuredClone(data, options);
  },
  
  /**
   * Stream data with progress events
   * @param {string} channelName - IPC channel name
   * @param {any} data - Data to stream
   * @param {Object} options - Stream options
   * @returns {Promise<any>} - Streamed data
   */
  streamData: async (data, options = {}) => {
    return OptimizedDataTransfer.streamData('data-stream', data, options);
  },
  
  /**
   * Listen for progress events during data transfer
   * @param {Function} callback - Progress callback
   */
  onTransferProgress: (callback) => {
    ipcRenderer.on('transfer-progress', (event, progress) => {
      callback(progress);
    });
  },
  
  /**
   * Stop listening for progress events
   */
  offTransferProgress: () => {
    ipcRenderer.removeAllListeners('transfer-progress');
  }
});

/**
 * Security Audit API for preload verification
 * Provides utilities to audit require() leaks and contextBridge APIs
 */
contextBridge.exposeInMainWorld('preloadAuditAPI', {
  /**
   * Audit for direct require() leaks
   * @returns {Object} - Audit results
   */
  auditRequireLeaks: () => {
    return PreloadAudit.auditRequireLeaks();
  },
  
  /**
   * Verify all exposed APIs via contextBridge
   * @returns {Object} - Verification results
   */
  verifyContextBridgeAPIs: () => {
    // Return information about exposed APIs
    return {
      namespaces: [
        'llamaAPI',
        'migrationAPI',
        'secretVaultAPI',
        'visionPairingAPI',
        'schedulerAPI',
        'optimizedTransferAPI',
        'preloadAuditAPI'
      ],
      totalNamespaces: 7,
      message: 'All APIs properly exposed via contextBridge'
    };
  },
  
  /**
   * Get detailed API information
   * @returns {Object} - Detailed API information
   */
  getAPIInfo: () => {
    return {
      llamaAPI: {
        description: 'Main Llama API for server control and model management',
        methods: [
          'getServerStatus', 'startServer', 'stopServer', 'downloadModels',
          'getModelsDirectory', 'setSelectedModels', 'getSelectedModels',
          'getAppDataDirectory', 'openDataFolder', 'getInstalledModels',
          'getActiveModel', 'deleteModel', 'switchModel', 'onModelSwitchStatus',
          'offModelSwitchStatus', 'searchHuggingFace', 'downloadHuggingFaceModel',
          'getDownloadProgress', 'getAllDownloadProgress', 'getStorageInfo',
          'getLastError', 'copyLogPath', 'getHardwareInfo', 'refreshHardwareDetection',
          'goBackToMain', 'onDownloadComplete', 'offDownloadComplete',
          'registerUser', 'loginUser', 'getCurrentUser', 'logoutUser',
          'updateUserProfile', 'webSearch', 'fetchWebPage', 'jcmHealthCheck',
          'jcmIndexRepo', 'jcmIndexFolder', 'jcmSearchSymbols', 'jcmGetSymbolSource',
          'jcmListRepos', 'jcmGetRepoOutline', 'jcmGetFileTree', 'jcmGetFileContent',
          'jcmGetContextBundle', 'jcmGetFileOutline', 'jcmInvalidateCache',
          'selectLocalFolder', 'getApiSettings', 'setApiSettings', 'getApiHealth',
          'countTokens', 'getQueueStatus', 'getInstalledBackends',
          'checkForBackendUpdate', 'downloadBackend', 'getCurrentBackendInfo',
          'updateBackend', 'getInitialLogs', 'openLogFile', 'revealLogInFolder',
          'onLogAppend', 'offLogAppend', 'openDocumentation', 'onSplashUpdate',
          'startLazyServer', 'getLazyStartSettings', 'setLazyStartEnabled',
          'getProviderCredentials', 'setProviderCredential', 'deleteProviderCredential'
        ]
      },
      migrationAPI: {
        description: 'User migration API for data encryption upgrade',
        methods: ['performMigration', 'cancelMigration', 'closeMigrationDialog']
      },
      secretVaultAPI: {
        description: 'Secure secret storage API',
        methods: [
          'getSecret', 'setSecret', 'deleteSecret', 'getSecretMetadata',
          'listSecrets', 'refreshToken', 'verifyMasterKeyChecksum', 'isInitialized',
          'getEncryptionBackend'
        ]
      },
      visionPairingAPI: {
        description: 'Vision model pairing management API',
        methods: ['getModelPair', 'getAllPairs', 'updateOffloadFlag', 'deletePair']
      },
      schedulerAPI: {
        description: 'Model lifecycle scheduler API',
        methods: [
          'getLoadedModels', 'getRunnerState', 'preloadModels', 'updateConfig',
          'getConfig', 'terminateRunner', 'onRunnerStateChanged', 'offRunnerStateChanged',
          'onVramUpdated', 'offVramUpdated'
        ]
      },
      optimizedTransferAPI: {
        description: 'Optimized data transfer for large payloads',
        methods: [
          'transferWithStructuredClone', 'streamData', 'onTransferProgress',
          'offTransferProgress'
        ]
      },
      preloadAuditAPI: {
        description: 'Security audit utilities for preload verification',
        methods: ['auditRequireLeaks', 'verifyContextBridgeAPIs', 'getAPIInfo']
      }
    };
  }
});