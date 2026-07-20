# IPC Channels

Communication between the Electron main process and the renderer (webui).

## Overview

Alpaca uses Electron's `contextBridge` to expose a single, explicitly-enumerated API object called `window.llamaAPI` from `preload.js`. The renderer never has direct access to `ipcRenderer`, Node.js, or the filesystem — all communication flows through the methods documented here.

:::note Security Model
All windows use `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. The only bridge between the renderer and main process is `window.llamaAPI` (plus `window.migrationAPI` and `window.secretVaultAPI` for specialized tasks). Adding a new IPC channel requires updating **both** `main.js` (handler) and `preload.js` (exposure).
:::

## Server & Backend

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getServerStatus()` | `get-server-status` | Get llama-server running state |
| `startServer()` | `start-server` | Start the llama-server backend |
| `stopServer()` | `stop-server` | Stop the backend |
| `startLazyServer()` | `start-lazy-server` | On-demand backend activation (lazy-start) |
| `getLazyStartSettings()` | `get-lazy-start-settings` | Get lazy-start configuration |
| `setLazyStartEnabled(enabled)` | `set-lazy-start-enabled` | Enable/disable lazy-start |
| `getInstalledBackends()` | `get-installed-backends` | List installed llama.cpp backend binaries |
| `checkForBackendUpdate()` | `check-for-backend-update` | Check for llama.cpp backend updates |
| `downloadBackend(backend, version)` | `download-backend` | Download a specific backend version |
| `getCurrentBackendInfo()` | `get-current-backend-info` | Get active backend info (version, variant) |
| `updateBackend()` | `update-backend` | Update the active llama.cpp backend |
| `checkReleaseForRepo(repo)` | `check-release-for-repo` | Check latest release for a specific repo (bonsai/upstream) |
| `getRepoPreference()` | `get-repo-preference` | Get llama.cpp repo variant preference |
| `setRepoPreference(pref)` | `set-repo-preference` | Set repo variant (bonsai vs upstream) |
| `checkSdCppUpdate()` | `check-sd-cpp-update` | Check for sd.cpp (stable-diffusion.cpp) updates |
| `getSdBackendInfo()` | `get-sd-backend-info` | Get sd.cpp backend info |
| `updateSdBackend()` | `update-sd-backend` | Update the sd.cpp backend |
| `getBonsaiExperimental()` | `get-bonsai-experimental` | Get experimental Bonsai 27B toggles (4-bit KV, spec decoding) |
| `setBonsaiExperimental(opts)` | `set-bonsai-experimental` | Set experimental Bonsai toggles |
| `checkDsparkDrafter()` | `check-dspark-drafter` | Check if dspark drafter GGUF is available |
| `onBackendUpdateProgress(cb)` | `backend-update-progress` (event) | Subscribe to backend update progress |
| `offBackendUpdateProgress(cb)` | — | Unsubscribe from backend update progress |

## Model Management

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getInstalledModels()` | `get-installed-models` | List installed GGUF models (excludes mmproj) |
| `importLocalModel()` | `import-local-model` | Import a local GGUF file via native picker |
| `importVisionModel()` | `import-vision-model` | Import an mmproj vision projector file |
| `getActiveModel()` | `get-active-model` | Get the currently active model filename |
| `deleteModel(filename)` | `delete-model` | Delete an installed model file |
| `switchModel(filename)` | `switch-model` | Switch the active model in MODEL mode |
| `onModelSwitchStatus(cb)` | `model-switch-status` (event) | Subscribe to model switch progress |
| `offModelSwitchStatus(cb)` | — | Unsubscribe from model switch progress |
| `downloadModels()` | `download-models` | Open the model download dialog |
| `getModelsDirectory()` | `get-models-directory` | Get the models directory path |
| `setSelectedModels(modelNames)` | `set-selected-models` | Set selected models (router mode) |
| `getSelectedModels()` | `get-selected-models` | Get selected models |
| `getStorageInfo()` | `get-storage-info` | Get disk usage info for models directory |

### HuggingFace Search & Download

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `searchHuggingFace(repoId, hfToken)` | `search-huggingface` | Search a HF repo for GGUF files |
| `downloadHuggingFaceModel(repoId, filename, hfToken)` | `download-huggingface-model` | Start a background model download |
| `getDownloadProgress(downloadId)` | `get-download-progress` | Poll progress of a specific download |
| `getAllDownloadProgress()` | `get-all-download-progress` | Get progress for all in-progress downloads |
| `onDownloadComplete(cb)` | `download-complete` (event) | Subscribe to download-complete events |
| `offDownloadComplete(cb)` | — | Unsubscribe from download-complete events |

### Bonsai Model Catalog

The bonsai model catalog mirrors `bonsai-beach` config and includes `bonsai-27b`, `bonsai-8b`, `bonsai-image-4b`, `bonsai-tts`, and `bonsai-stt`.

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `bonsaiListModels()` | `bonsai:list-models` | List all bonsai catalog models |
| `bonsaiListChatModels()` | `bonsai:list-chat-models` | List chat-capable bonsai models |
| `bonsaiGetImageModel()` | `bonsai:get-image-model` | Get the bonsai image model |
| `bonsaiListMissingFiles(modelId)` | `bonsai:list-missing-files` | List missing files for a bonsai model |
| `bonsaiDownloadModel(modelId)` | `bonsai:download-model` | Download all missing files for a bonsai model |
| `bonsaiGetDownloadProgress(modelId)` | `bonsai:get-download-progress` | Aggregate download progress for a bonsai model |

## Voice Service (STT/TTS)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `voiceGetStatus()` | `voice:getStatus` | Get STT/TTS readiness |
| `voiceTranscribe(base64Audio, format)` | `voice:transcribe` | Transcribe audio via whisper.cpp |
| `voiceSynthesize(text, options)` | `voice:synthesize` | Text-to-speech (browser/MOSS-TTS/tts.cpp) |
| `voiceDownloadModel(modelName, url)` | `voice:downloadModel` | Download a whisper model |

## Image Service (sd.cpp / Bonsai Image 4B)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `imageGetStatus()` | `image:getStatus` | Get image service readiness |
| `imageEnsureReady()` | `image:ensureReady` | Ensure sd.cpp + Bonsai Image 4B are ready |
| `imageGenerate(params)` | `image:generate` | Generate an image via sd.cpp |
| `imageOpenImageFolder()` | `image:openImageFolder` | Open the generated images folder |

## Knowledge Base & RAG

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `kbGetCollections()` | `kb:get-collections` | List KB collections |
| `kbCreateCollection(name, description)` | `kb:create-collection` | Create a new collection |
| `kbDeleteCollection(id)` | `kb:delete-collection` | Delete a collection |
| `kbIngestDocuments(collectionId, files, options)` | `kb:ingest-documents` | Ingest files into a collection |
| `kbIngestUrl(collectionId, url, options)` | `kb:ingest-url` | Ingest a web URL into a collection |
| `kbSearch(collectionId, query, topK)` | `kb:search` | Semantic search across a collection |
| `kbGetDocuments(collectionId)` | `kb:get-documents` | List documents in a collection |
| `kbDeleteDocument(collectionId, docId)` | `kb:delete-document` | Delete a document |
| `kbGetMcpConfig()` | `kb:get-mcp-config` | Get the KB MCP server config |
| `kbRestartMcpServer()` | `kb:restart-mcp-server` | Restart the KB MCP server |

## Workspace

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `workspaceGetState()` | `workspace:get-state` | Get workspace state (folder, sandbox) |
| `workspaceSetFolder(folderPath)` | `workspace:set-folder` | Set the local workspace folder |
| `workspaceOpenSandbox()` | `workspace:open-sandbox` | Open/create the sandbox workspace |
| `workspaceGetFileTree(folderPath, depth)` | `workspace:get-file-tree` | Get the file tree for a folder |
| `selectLocalFolder()` | `select-local-folder` | Open native folder picker |

## TUI (Terminal UI)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `tuiLaunch(opts)` | `tui:launch` | Launch the alpaca-tui binary in a new terminal |
| `tuiGetWorkspace()` | `tui:get-workspace` | Get TUI workspace folder |
| `tuiSetWorkspace(folderPath)` | `tui:set-workspace` | Set TUI workspace folder |
| `tuiFindBinary()` | `tui:find-binary` | Check if the alpaca-tui binary is available |

## Launch Service (Integrations)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `launchListIntegrations()` | `launch:list-integrations` | List 24+ third-party tool integrations |
| `launchConfigure(integrationId, model)` | `launch:configure` | Get config instructions for a tool |
| `launchGenerateEnv(integrationId, model)` | `launch:generate-env` | Generate a `.env` file for a tool |
| `launchOpenEnvFolder()` | `launch:open-env-folder` | Open the env files folder |
| `launchCheckInstalled(integrationId)` | `launch:check-installed` | Check if a tool is installed (returns `{ installed, method, detail }`) |
| `launchCheckAllInstalled()` | `launch:check-all-installed` | Check all integrations (returns map of id → install status) |
| `launchLaunchIntegration(integrationId, model)` | `launch:launch-integration` | Check install, then launch the tool in a new terminal with Alpaca env vars preset, or return "not installed" error |

## IDE Config Generator

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `ideGenerateConfigs(ideId, modelName)` | `ide:generate-configs` | Generate IDE config files |
| `ideListSupported()` | `ide:list-supported` | List supported IDEs |
| `ideOpenConfigFolder()` | `ide:open-config-folder` | Open the IDE config folder |

## Provider Credentials (Cloud Providers)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getProviderCredentials()` | `get-provider-credentials` | List all cloud provider credentials |
| `setProviderCredential(id, name, baseUrl, apiKey, models)` | `set-provider-credential` | Add/update a provider credential |
| `deleteProviderCredential(id)` | `delete-provider-credential` | Delete a provider credential |

## VRAM & GPU

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `detectVramBudget()` | `detect-vram-budget` | Detect GPU VRAM and compute budget |
| `getActiveAllocationsMB()` | `get-active-allocations-mb` | Get VRAM used by loaded models |
| `autoTuneNgl(params)` | `auto-tune-ngl` | Auto-tune GPU layer count for a model |

## API Server Settings & Monitoring

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getApiSettings()` | `get-api-settings` | Get API server config (host, port, CORS, etc.) |
| `setApiSettings(settings)` | `set-api-settings` | Update API server config |
| `getApiHealth()` | `api:health` | API health check |
| `countTokens(messages, model)` | `api:count-tokens` | Count tokens for a message array |
| `getQueueStatus()` | `api:queue-status` | Get request queue status |

## User Authentication (Local)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `registerUser(username, password, email, bio)` | `register-user` | Register a local user |
| `loginUser(username, password)` | `login-user` | Log in a local user |
| `getCurrentUser()` | `get-current-user` | Get the current user |
| `logoutUser()` | `logout-user` | Log out the current user |
| `updateUserProfile(updates)` | `update-user-profile` | Update user profile |

## Web Search & Retrieval

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `webSearch(query, maxResults)` | `web-search` | Web search |
| `fetchWebPage(url)` | `fetch-web-page` | Fetch a web page |

## jCodeMunch (Code Retrieval)

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `jcmHealthCheck()` | `jcm-health-check` | Check jcodemunch-mcp availability |
| `jcmIndexRepo(repoUrl)` | `jcm-index-repo` | Index a Git repo |
| `jcmIndexFolder(folderPath)` | `jcm-index-folder` | Index a local folder |
| `jcmSearchSymbols(repo, query, maxResults, kind)` | `jcm-search-symbols` | Search symbols in a repo |
| `jcmGetSymbolSource(repo, symbolId)` | `jcm-get-symbol-source` | Get source for a symbol |
| `jcmListRepos()` | `jcm-list-repos` | List indexed repos |
| `jcmGetRepoOutline(repo)` | `jcm-get-repo-outline` | Get repo outline |
| `jcmGetFileTree(repo, pathPrefix)` | `jcm-get-file-tree` | Get file tree |
| `jcmGetFileContent(repo, filePath)` | `jcm-get-file-content` | Get file content |
| `jcmGetContextBundle(repo, symbolId, includeCallers)` | `jcm-get-context-bundle` | Get context bundle for a symbol |
| `jcmGetFileOutline(repo, filePath)` | `jcm-get-file-outline` | Get file outline |
| `jcmInvalidateCache(repo)` | `jcm-invalidate-cache` | Invalidate cache for a repo |

## Diagnostics & Logging

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getLastError()` | `get-last-error` | Get the last main-process error |
| `copyLogPath()` | `copy-log-path` | Copy the log file path to clipboard |
| `getHardwareInfo()` | `get-hardware-info` | Get hardware info (CPU, GPU, RAM) |
| `refreshHardwareDetection()` | `refresh-hardware-detection` | Re-run hardware detection |
| `getInitialLogs()` | `logs:get-initial` | Get the tail of the service log file |
| `openLogFile()` | `logs:open-file` | Open the log file |
| `revealLogInFolder()` | `logs:reveal-in-folder` | Reveal the log file in the file manager |
| `onLogAppend(cb)` | `logs:append` (event) | Subscribe to live log append events |
| `offLogAppend(cb)` | — | Unsubscribe from log append events |

## App Data & Navigation

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getAppDataDirectory()` | `get-app-data-directory` | Get the app data directory path |
| `openDataFolder()` | `open-data-folder` | Open the app data folder |
| `goBackToMain()` | `go-back-to-main` | Navigate back to the main window |
| `openDocumentation(docPath)` | `docs:open` | Open a bundled docs page in a window |
| `onSplashUpdate(cb)` | `splash:update` (event) | Subscribe to splash screen progress |

## Other Bridge Objects

In addition to `window.llamaAPI`, the preload script exposes two specialized bridges:

### `window.migrationAPI`

Used by the migration dialog for user data migration between app versions.

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `performMigration()` | `migration:performMigration` | Start the migration |
| `cancelMigration()` | `migration:cancelMigration` | Cancel an in-progress migration |
| `closeMigrationDialog()` | `migration:closeDialog` | Close the migration dialog |

### `window.secretVaultAPI`

Secure secret storage using AES-256-GCM with PBKDF2 key derivation (see `desktop/secret-vault.js`).

| Method | IPC Channel | Description |
|--------|-------------|-------------|
| `getSecret(key)` | `vault:getSecret` | Retrieve a secret |
| `setSecret(key, value, metadata)` | `vault:setSecret` | Store a secret |
| `deleteSecret(key)` | `vault:deleteSecret` | Delete a secret |
| `hasSecret(key)` | `vault:hasSecret` | Check if a secret exists |
| `listSecretKeys()` | `vault:listSecretKeys` | List all secret keys (no values) |

## Usage Example

### From the renderer (webui)

```typescript
// All access goes through window.llamaAPI — never ipcRenderer directly.
const api = (window as any).llamaAPI;
const models = await api.getInstalledModels();
await api.switchModel('Ternary-Bonsai-27B-Q2_0.gguf');
```

### Adding a new IPC channel

1. Register the handler in `desktop/main.js`:
   ```javascript
   ipcMain.handle('my-new-channel', async (event, arg) => {
     return { result: arg };
   });
   ```
2. Expose it in `desktop/preload.js` inside the `llamaAPI` object:
   ```javascript
   myNewMethod: (arg) => ipcRenderer.invoke('my-new-channel', arg),
   ```
3. If the new module is `require()`d by `main.js`, add it to the `files` array in `desktop/package.json` (the build uses an explicit list, not `*.js`).

## See Also

- [REST API Reference](./rest-api.md) — HTTP endpoints on the API gateway
- [Tool Calling](./tool-calling.md) — OpenAI-compatible function calling
