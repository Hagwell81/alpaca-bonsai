# DOX framework — Desktop (Electron Main Process)

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
6. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

## Update After Editing

Every meaningful change requires a DOX pass before the task is done. Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

## Purpose

Electron main-process runtime, system tray, API server, model management, knowledge base, workspace, integrations, and all native Node.js services that power the Alpaca desktop application.

## Ownership

All `.js` files in this directory are owned by the desktop main process. HTML/JS pairs are embedded UI surfaces rendered in BrowserWindows.

## Local Contracts

- **Secure IPC:** `preload.js` is the only bridge; never expose raw `ipcRenderer` or `remote`. All IPC channels must be explicitly listed in `preload.js`.
- **Context Isolation:** All `BrowserWindow` instances use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Binary Discovery:** Binaries are discovered in bundled paths first, then user config path, then auto-download.
- **Persistence:** User settings use `electron-store`. Sensitive data uses `secret-vault.js` (PBKDF2 + AES-256-GCM).
- **API Port:** OpenAI-compatible API runs on `127.0.0.1:13434` (primary slot). API Gateway proxy on `127.0.0.1:13439` routes across slots 13434-13438. TUI connects to the API Gateway (13439) for intelligent routing. **Important:** `startLlamaServer()` registers the spawned process with both the Scheduler (for lifecycle management) AND the SlotManager (via `registerExternalRunner()`) so the API Gateway can route requests to it. Without the SlotManager registration, the gateway returns 503 `no_model_slot_available` because `selectSlot()` only returns slots with `status === 'running'`.
- **Packaging:** Every `.js` module `require()`d by `main.js` (directly or transitively from a bundled entry) MUST be listed in the electron-builder `files` array in `package.json`. Missing entries silently break the packaged app. The current `files` array enumerates each JS module explicitly (it does NOT use `*.js`), so adding a new module requires updating `package.json` in the same change.

## Work Guidance

### Entry Points & IPC Bridge

| File | Purpose |
|------|---------|
| `main.js` | Electron main process entry. Hardware detection, server start, tray, IPC handler registration, window lifecycle. Also exposes `isMmprojFile(filename)` helper (matches both `mmproj-*` and `*-mmproj-*` naming conventions) used across all mmproj filtering sites. |
| `preload.js` | Secure renderer bridge (`window.llamaAPI`). Single source of truth for all IPC channels. |

**Rule:** Any new IPC channel must be registered in `main.js` AND exposed in `preload.js`.

**IPC channels for backend release management:**
- `check-for-backend-update` / `update-backend` — check and update the active llama.cpp backend
- `check-release-for-repo` — check latest release from a specific repo (bonsai variant or upstream)
- `get-repo-preference` / `set-repo-preference` — get/set llama.cpp repo variant preference (bonsai vs upstream)
- `check-sd-cpp-update` / `update-sd-backend` / `get-sd-backend-info` — independent sd.cpp release check, update, and info
- `get-bonsai-experimental` / `set-bonsai-experimental` — get/set experimental Bonsai 27B feature toggles (4-bit KV cache, speculative decoding)
- `check-dspark-drafter` — check if the dspark drafter GGUF is available for speculative decoding

**IPC channels for TUI (Terminal UI) launch and workspace:**
- `tui:launch` — launch the alpaca-tui binary in a new terminal window (passes --workspace if configured)
- `tui:get-workspace` — get TUI workspace folder (TUI-specific setting, falls back to main workspace)
- `tui:set-workspace` — set TUI workspace folder (stored as `tui.workspaceFolder` in electron-store)
- `tui:find-binary` — check if the alpaca-tui binary is available on disk

### API Layers

| File | Purpose |
|------|---------|
| `api-server.js` | OpenAI-compatible standalone REST API server (localhost:13434). |
| `api-gateway.js` | OpenAI-compatible request proxy and routing layer on port 13439. Includes `/v1/images/generations` and `/v1/images/status` endpoints for sd.cpp image generation, `/v1/desktop/*` model-management endpoints (installed-models, HuggingFace search/download, download-progress, delete) that mirror the Electron IPC handlers so the standalone webui can manage models via HTTP, and the Anthropic + Ollama compatibility shims (delegated to `api-compat.js`). CORS preflight (`OPTIONS`) and permissive `Access-Control-Allow-Origin: *` headers are handled for `/v1/desktop/*`, `/api/*`, and `/v1/messages` paths. **Important:** `_proxyRequest()` must update the `Content-Length` header after modifying the body (sampling defaults, grammar injection) — a stale Content-Length causes the upstream to read truncated JSON and return 500. `_applySamplingDefaults()` maps internal camelCase config keys (`temp`, `topK`) to OpenAI API parameter names (`temperature`, `top_k`) before injecting them. |
| `api-compat.js` | Anthropic Messages API (`/v1/messages`) and Ollama-native API (`/api/tags`, `/api/chat`, `/api/generate`, `/api/show`, `/api/version`, `/api/ps`, `/api/embed`, `/api/embeddings`) compatibility shims. Translates requests to the gateway's OpenAI-compatible endpoints via internal HTTP loopback (127.0.0.1:13439), then converts responses back. Lets Claude Code (Anthropic SDK) and any Ollama-native client use Alpaca as a backend without a proxy. Supports streaming for both protocols (Anthropic SSE events; Ollama newline-delimited JSON), tool calling, image content blocks, thinking/reasoning, and structured outputs (`format: "json"` / JSON schema). Exported functions: `anthropicToOpenAI`, `openAIToAnthropic`, `ollamaChatToOpenAI`, `openAIToOllamaChat`, `ollamaGenerateToOpenAI`, `openAIToOllamaGenerate`, `openAIModelToOllama`. |

### Model Management

| File | Purpose |
|------|---------|
| `binary-manager.js` | Auto-download correct llama.cpp backend binaries (CPU/CUDA/Vulkan/HIP) from GitHub releases. Supports runtime switching between bonsai variant (PrismML-Eng/llama.cpp) and upstream (ggml-org/llama.cpp). Also manages sd.cpp (stable-diffusion.cpp) binary downloads with backend-specific asset matching. |
| `model-manager.js` | Model discovery, HuggingFace download with resume support, SHA-256 verification. |
| `model-slot-manager.js` | Multi-model slot allocation and lifecycle. Includes `registerExternalRunner()` to register externally-spawned llama-server processes (from `startLlamaServer()`) so the API Gateway can route to them. |
| `model-loader.js` | Low-level model loading helpers. |
| `model-config-store.js` | Persistent model configuration cache. |
| `model-classifier.js` | Model architecture/type detection from GGUF metadata. |
| `model-preset-db.js` | Built-in and custom parameter presets per model family. Includes Ternary Bonsai presets (27B/8B/4B) with flash attention, sampling defaults, and reasoning flags from the Bonsai-demo project. |
| `gguf-metadata-cache.js` | Fast cached GGUF header/metadata reading. |
| `ngl-optimizer.js` | GPU layer-count optimizer for best performance/VRAM tradeoff. |
| `preset-recommender.js` | Suggests presets based on detected hardware + model. |
| `slot-args-builder.js` | Builds CLI args for a loaded slot. |
| `slot-selector.js` | Chooses which slot to use for an inference request. |
| `hf-model-service.js` | HuggingFace model catalog, search any GGUF repo, curated lists. |
| `eviction-ranker.js` | Smart model eviction ordering under memory pressure. |
| `runner-ref.js` | Backend runner reference counting and cleanup. |
| `request-batcher.js` | Request batching and coalescing. |

### AI & Features

| File | Purpose |
|------|---------|
| `launch-service.js` | Integration launcher: 25+ third-party tool presets (IDEs, coding agents, RAG, automation). Provides `checkIfInstalled()` (detects whether each tool is installed via `INSTALL_DETECTORS` — checks PATH commands, macOS `.app` bundles, and custom `extraCheck` functions), `checkAllInstalled()` (batch), and `launchIntegration()` (checks install status, then launches the tool in a new terminal window with Alpaca env vars preset, or returns an "not installed" error with install detail). Placeholder env vars (values wrapped in `<>`) are filtered out before launch. IPC channels: `launch:list-integrations`, `launch:configure`, `launch:generate-env`, `launch:open-env-folder`, `launch:check-installed`, `launch:check-all-installed`, `launch:launch-integration`. |
| `grammar-library.js` | GBNF grammar generation for structured JSON output. |
| `vision-pairing-manager.js` | Automatic vision model pairing with base LLMs. |
| `voice-service.js` | STT via whisper.cpp CLI; TTS via browser synthesis or optional MOSS-TTS. Uses bonsai-beach Whisper/OuteTTS model URLs. |
| `image-service.js` | Local image generation via sd.cpp (sd-cli) and the Bonsai Image 4B model. Model files downloaded during onboarding. HTTP endpoint at `/v1/images/generations` on the API gateway (port 13439). |
| `bonsai-models.js` | Bonsai model catalog (bonsai-27b, bonsai-8b, bonsai-image-4b, bonsai-tts, bonsai-stt) with download URLs. The 27B includes an optional dspark drafter GGUF for speculative decoding. Mirrors bonsai-beach config.rs. |
| `tool-rewriter.js` | Streaming tool-call rewriting. |

### Knowledge Base & Workspace

| File | Purpose |
|------|---------|
| `knowledge-base.js` | RAG knowledge base: document collections, ingestion, search. |
| `knowledge-base-mcp.js` | MCP integration for knowledge base tools. |
| `knowledge-base-mcp-launcher.js` | Launcher for KB MCP server. |
| `workspace-manager.js` | Local project workspace: folder selection, file tree, IDE config generation. |
| `ide-config-generator.js` | Generates IDE config files (VS Code, JetBrains, etc.) pointing to local API. |

### User Experience

| File | Purpose |
|------|---------|
| `splash-manager.js` | Animated splash screen with progress IPC updates. |
| `lazy-start-manager.js` | On-demand backend activation; landing page generation when no server. |
| `user-migration.js` | Seamless user data migration between app versions. |
| `migration-dialog-manager.js` | Migration confirmation dialog UI logic. |
| `first-run.js` / `first-run.html` | First-launch onboarding overlay. |
| `settings.js` / `settings.html` | Standalone settings page. |
| `logs-viewer.js` / `logs-viewer.html` | In-app log viewer. |
| `telemetry-ui.js` / `startup-telemetry.js` | Anonymous startup telemetry. |

### Infrastructure

| File | Purpose |
|------|---------|
| `scheduler.js` | Background task scheduling (model lifecycle, cleanup). |
| `request-manager.js` | Circuit breaker + request queue for backend calls. |
| `backend-feature-detector.js` | Probes backend capabilities (model formats, endpoints). |
| `health-probe.js` | Lightweight HTTP health checks. |
| `chat-template-detector.js` | Detects chat template from model metadata. |
| `advanced-args.js` | Advanced CLI argument parsing helpers. |

### Security

| File | Purpose |
|------|---------|
| `secret-vault.js` | Encrypted credential storage with PBKDF2 key derivation. |
| `key-derivation.js` | Key derivation helpers for vault operations. |
| `api-key-migration.js` | Migrates legacy API key storage to vault. |
| `hf-token-migration.js` | Migrates legacy HF token storage to vault. |

### GPU / Performance

| File | Purpose |
|------|---------|
| `vram-budget-manager.js` | GPU memory allocation and optimization. |
| `vram-tracker.js` | Real-time VRAM usage tracking. |

### Build & Packaging Helpers

| File | Purpose |
|------|---------|
| `build-webui.js` | Copies webui/public + media into desktop bundle. |
| `build-docs.js` | Copies docs/build into desktop bundle. |
| `clean-dist.js` | Cleans build artifacts. |
| `build-all-backends.ps1` | PowerShell script for building all C++ backends. |

## Verification

- `test-desktop.ps1` — Desktop-specific PowerShell tests
- `test-load.js` — Load/performance smoke tests
- Run `cd desktop && npm start` for manual Electron validation

## Child DOX Index

This directory is flat; all modules are documented in the Work Guidance above. No sub-boundaries require child AGENTS.md files.
