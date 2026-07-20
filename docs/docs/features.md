# Alpaca Features

This guide covers every major feature implemented in Alpaca, with setup instructions and usage notes.

---

## Core Chat

- **Multi-model chat** — Load and switch between local GGUF models on the fly
- **Multi-provider support** — OpenAI, Google Gemini, Anthropic Claude, Mistral AI, OpenRouter, Ollama, LM Studio, Azure Foundry, and any custom OpenAI-compatible endpoint
- **Conversation management** — Persistent threads with SQLite storage, export to JSON/Markdown
- **Chat templates** — Auto-detected from GGUF metadata with manual override
- **Streaming responses** — Real-time token streaming with SSE
- **Vision models** — Automatic mmproj pairing for multimodal models
- **Tool calling** — Built-in tool registry with 100+ tools, auto-rewriting for local models
- **System prompts** — Per-model and per-conversation system prompts
- **Response regeneration** — Retry with the same or different parameters
- **Continue generation** — Resume incomplete responses (stable feature, configurable in Settings)

---

## Knowledge Base & RAG

A fully local retrieval-augmented generation system with no external dependencies.

### Document Ingestion
Supported formats:
- **Plain text** (.txt, .md)
- **PDF** (.pdf) via `pdf-parse`
- **Word** (.docx) via `mammoth`
- **Web URLs** — Fetched and chunked automatically

### How to use
1. Open the **Knowledge Base** panel in the sidebar
2. Create a collection (e.g. "Project Docs")
3. Ingest files via drag-and-drop, file picker, or URL
4. Toggle **Use Knowledge Base** in chat settings
5. Your queries will automatically retrieve relevant chunks and inject them into the system prompt

### Vector Search
- Embeddings generated through the local `/v1/embeddings` endpoint (slot 3)
- Cosine-similarity search in JavaScript
- Configurable top-K retrieval (default 5)
- Sentence-aware chunking with overlap

### MCP Server
The Knowledge Base also exposes an MCP (Model Context Protocol) server with 4 tools:
- `kb_search` — Semantic search across collections
- `kb_list_collections` — Browse available collections
- `kb_get_documents` — List documents in a collection
- `kb_build_rag_context` — Build RAG context for a query

IDEs and agents can connect to this server for project-specific context.

---

## Workspace Manager

Manage project files directly from the chat interface.

### Local Folder
- Select any folder on your system via a native file picker
- Browse the file tree in the **Workspace** panel
- Files are indexed for context injection (when paired with Knowledge Base)

### Sandbox Workspace
- Create an isolated workspace in the app data directory
- Copy files from your local folder into the sandbox
- Safe environment for the AI to read and suggest modifications

### How to use
1. Open the **Workspace** panel in the sidebar
2. Click **Select Local Folder** to choose a project directory
3. Or click **Open Sandbox** to create an isolated workspace
4. The file tree updates automatically and can be refreshed

---

## IDE Integration

Generate configuration files for popular editors to connect to your local API.

### Supported IDEs
- **VS Code + Continue** — `.continue/config.json`
- **VS Code + Copilot Chat** — Reference documentation
- **Cursor** — `.cursorrules`
- **JetBrains** — `jetbrains-ai-config.md`
- **Generic MCP** — `mcp-config.json`

### How to use
1. Go to **Settings** → **IDE Integration**
2. Select your IDE and model
3. Click **Generate Configs**
4. The configs are written to your app data folder
5. Click **Open Config Folder** to copy them into your IDE

---

## Integration Launch Service

One-click configuration for 24+ third-party tools to use Alpaca as their AI backend.

### Categories
- **Coding Agents** — Claude Code, Codex App/CLI, Copilot CLI, Cline CLI, OpenCode, Droid, Goose, Pi, Pool
- **Assistants** — OpenClaw, Hermes Agent
- **IDEs** — VS Code, Cline, Roo Code, JetBrains, Xcode, Zed
- **Chat & RAG** — Onyx
- **Automation** — n8n
- **Notebooks** — marimo
- **Sandboxing** — NemoClaw
- **Built-in Bots** — Discord, Slack

### How to use
1. Open the **Integrations** panel (sidebar tab)
2. Select a category, then a tool
3. Click **Configure** to see instructions, environment variables, and manual commands
4. Click **.env** to generate a ready-to-source environment file
5. Copy individual variables or the full command to your clipboard

---

## Voice Service

Local speech-to-text and text-to-speech without cloud dependencies.

### Speech-to-Text (STT)
- Uses **whisper.cpp** for local transcription
- Auto-downloads whisper models on first use
- Supports microphone input in the chat interface
- Language auto-detection

### Text-to-Speech (TTS)
- **tts.cpp** (llama-tts / tts-cli) — Local neural synthesis
- **MOSS** — Lightweight local fallback
- **Browser** — Web Speech API fallback (always available)

### How to use
1. Click the **microphone** icon in the chat input to record speech
2. Click the **speaker** icon on any assistant message to hear it spoken
3. Configure voice and speed in **Settings** → **Voice**

---

## Discord & Slack Bots

Ready-to-run bots that proxy chat requests to your local model.

### Discord Bot
- Responds to `@mentions` and DMs
- Conversation history per channel/user
- Typing indicators while generating

### Slack Bot
- Socket Mode (no public URL required)
- Responds to app mentions and direct messages
- Thread-aware replies

### Setup
```bash
# Discord
cd bots/discord-bot
npm install
# Set DISCORD_BOT_TOKEN and ALPACA_API_URL in .env
npm start

# Slack
cd bots/slack-bot
npm install
# Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env
npm start
```

---

## Scheduler & VRAM Management

### Intelligent Scheduler
- Persistent runner processes with zero-cost model reuse
- Concurrent multi-model hosting across GPU slots
- Automatic eviction based on workload and VRAM pressure
- Health probes and automatic restarts

### VRAM Budget Manager
- Automatic GPU memory detection
- Per-model VRAM estimation from GGUF metadata
- Budget enforcement with configurable headroom
- Automatic NGL (GPU layer) optimization via `Fit-to-VRAM`

### Active Allocations Tracking
- Real-time tracking of VRAM used by currently loaded models
- `activeAllocationsMB` dynamically computed from the scheduler
- Used by the NGL optimizer to avoid over-committing GPU memory

---

## Model Management

- **HuggingFace integration** — Curated GGUF list + search any repository
- **Model presets** — Recommended settings per model with one-click apply
- **NGL optimizer** — Automatic GPU layer tuning based on available VRAM
- **Vision pairing** — Automatic mmproj file detection for vision models
- **GGUF metadata cache** — Fast metadata without re-parsing
- **jcodemunch-mcp** — Build integration for the token-efficient MCP server (falls back to system Python)
- **mmproj filtering** — Vision projector files are filtered out of the chat model list (matches both `mmproj-*` and `*-mmproj-*` naming conventions)

### Bonsai Model Catalog

Alpaca ships with a built-in catalog of Bonsai models (mirrors `bonsai-beach` config). The onboarding flow can download all prerequisite files automatically:

| Model | Type | Files |
|-------|------|-------|
| **bonsai-27b** | Chat + Vision (Ternary) | `Ternary-Bonsai-27B-Q2_0.gguf`, `Ternary-Bonsai-27B-mmproj-Q8_0.gguf`, optional `Ternary-Bonsai-27B-dspark-Q4_1.gguf` (speculative decoding drafter) |
| **bonsai-8b** | Chat (Ternary) | `Ternary-Bonsai-8B-Q2_0.gguf` |
| **bonsai-image-4b** | Image generation | `bonsai_image_4b-mod_q8_0-q1_0.gguf`, `Qwen3-4B-UD-IQ3_XXS.gguf`, `full_encoder_small_decoder.safetensors` |
| **bonsai-tts** | Text-to-speech | `OuteTTS-0.2-500M-Q8_0.gguf`, `WavTokenizer-Large-75-Q4_0.gguf` |
| **bonsai-stt** | Speech-to-text | `ggml-large-v3-turbo-q8_0.bin` (Whisper large-v3 turbo) |

### Standalone Webui Model Management

The webui can manage models even when running outside Electron (e.g. in a browser for UI testing). The `DesktopService` client in `src/lib/services/desktop.service.ts` routes through `window.llamaAPI` IPC when available and falls back to HTTP endpoints on the API gateway (`/v1/desktop/*` on port 13439) otherwise. This means model search, download, and deletion work in both the desktop app and the standalone webui.

---

## Image Generation

Alpaca includes local image generation via **sd.cpp** (stable-diffusion.cpp) and the **Bonsai Image 4B** model.

- **Model**: Bonsai Image 4B (auto-downloaded during onboarding or on first visit to the Image page)
- **Backend**: sd-cli (sd.cpp binary, auto-downloaded per GPU backend)
- **Dedicated page**: `/image` route with prompt, steps, CFG, sampler, seed, and dimensions controls
- **API**: `POST /v1/images/generations` and `GET /v1/images/status` on the API gateway
- **Gallery**: Generated images are saved to a local folder (open via the Image page or `imageOpenImageFolder()` IPC)

### How to use
1. Open the **Image** page from the sidebar
2. If the model isn't downloaded, the page auto-downloads missing files on first visit
3. Enter a prompt and adjust steps/CFG/sampler/seed
4. Click **Generate** — the job runs in the background
5. Generated images appear in the gallery and are saved to disk

---

## Tool Calling (Function Calling)

Alpaca supports OpenAI-compatible tool calling on the `/v1/chat/completions` endpoint. The model can request tool calls, the caller executes them, and the results are fed back for a final answer.

- **Streaming tool calls**: Tool-call arguments arrive as incremental deltas in `delta.tool_calls[].function.arguments`, accumulated by `index`
- **Tool rewriting**: The gateway includes automatic tool-call rewriting for local models that emit tool calls as text rather than structured `tool_calls`
- **Built-in TUI tools**: The alpaca-tui ships with `read_file`, `list_dir`, and `web_fetch` tools that are sent on every chat request, with an agentic loop that executes them locally

See the [Tool Calling](./api/tool-calling.md) documentation for the full protocol, streaming delta accumulation, and external app integration examples.

---

## Terminal UI (TUI)

A Rust-based terminal user interface (`alpaca-tui`) for chat and model management, inspired by the Claude Code CLI.

- **Built with**: ratatui + crossterm + tui-textarea
- **Connects to**: the API gateway on `127.0.0.1:13439` (configurable via `--control`)
- **Features**: Streaming chat with SSE, reasoning/thinking display (`reasoning_format: "auto"`), slash commands, multi-line input, scrollback history, model selection, built-in tools (read_file, list_dir, web_fetch) with an agentic loop
- **Workspace**: Optional `--workspace <DIR>` for file context; workspace selection step at startup if not provided
- **mmproj filtering**: Vision projector files are filtered from the model list (matches both `mmproj-*` and `*-mmproj-*` conventions)

### Launch from the desktop app
- Tray menu → **Open Terminal UI**
- Settings → Providers → Terminal UI card → **Launch**
- The desktop app finds the binary at `tui/target/release/alpaca-tui` (dev) or `resources/tui/alpaca-tui` (packaged)

### Launch standalone
```bash
cd tui && cargo build --release
./target/release/alpaca-tui --control http://127.0.0.1:13439
```

See the TUI's `AGENTS.md` in the `tui/` directory for the full CLI reference, slash commands, and keyboard shortcuts.

---

## Security

- **Secret Vault** — AES-256-GCM encrypted storage with machine-bound key derivation
- **API key migration** — Automatic migration of legacy keys into the vault
- **GPG verification** — Binary signature checking with ggml-org public key
- **HuggingFace token** — Secure storage for HF model downloads

---

## Settings

All configurable options are exposed in the unified Settings UI:

| Section | Options |
|---------|---------|
| **Models** | Local model list, cloud provider credentials, router mode |
| **Inference** | Temperature, top-p, top-k, repeat penalty, context window |
| **GPU** | NGL override, VRAM budget, backend selection (CUDA/Vulkan/Metal) |
| **Voice** | Whisper model, TTS mode (local/browser), voice selection, speed |
| **Knowledge Base** | Enable/disable, default collection, chunk size, overlap |
| **Workspace** | Default folder path, sandbox auto-create |
| **Experimental** | Python interpreter (Pyodide), Continue generation |
| **IDE Integration** | Config generation for Continue, Cursor, JetBrains |
| **Integrations** | One-click setup for 24+ external tools |

---

## API Endpoints

The API gateway runs on `127.0.0.1:13439` and proxies to the underlying llama-server on `127.0.0.1:13434`. It speaks three protocol families: OpenAI-compatible (`/v1/*`), Anthropic-compatible (`/v1/messages`), and Ollama-compatible (`/api/*`).

### OpenAI-Compatible

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat (streaming + non-streaming, tool calling) |
| `/v1/completions` | POST | OpenAI-compatible text completions |
| `/v1/embeddings` | POST | OpenAI-compatible embeddings (used by RAG) |
| `/v1/models` | GET | List loaded models |
| `/v1/slots/status` | GET | Status of all model slots (VRAM, busy state) |
| `/tokenize` | POST | Tokenize text to token IDs |
| `/detokenize` | POST | Convert token IDs back to text |
| `/health` | GET | Server health check |
| `/metrics` | GET | Prometheus-style metrics |
| `/props` | GET | Server properties (defaults, modalities, context size) |

### Anthropic-Compatible

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/messages` | POST | Anthropic Messages API (Claude Code, Anthropic SDK) |

### Ollama-Compatible

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tags` | GET | List local models (Ollama format) |
| `/api/ps` | GET | List running models |
| `/api/version` | GET | Server version |
| `/api/show` | POST | Show model details |
| `/api/chat` | POST | Chat completion (Ollama format) |
| `/api/generate` | POST | Text generation (Ollama format) |
| `/api/embed` | POST | Generate embeddings (Ollama format) |
| `/api/embeddings` | POST | Alias for `/api/embed` |

### Image Generation (Gateway-Only)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/images/generations` | POST | Generate an image via sd.cpp (Bonsai Image 4B) |
| `/v1/images/status` | GET | Image service status |

### Desktop Model Management (Gateway-Only)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/desktop/installed-models` | GET | List installed GGUF models |
| `/v1/desktop/huggingface/search` | POST | Search HuggingFace for GGUF files |
| `/v1/desktop/huggingface/download` | POST | Start a model download |
| `/v1/desktop/download-progress` | GET | Poll download progress |
| `/v1/desktop/models/delete` | POST | Delete an installed model |

See the [REST API Reference](./api/rest-api.md) and [Tool Calling](./api/tool-calling.md) for request/response details.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Send message |
| `Ctrl+Shift+Enter` | New line |
| `Ctrl+E` | Toggle settings |
| `Ctrl+M` | Model selector |
| `Ctrl+K` | Knowledge Base panel |
| `Ctrl+W` | Workspace panel |
| `Ctrl+I` | Integrations panel |
