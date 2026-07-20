---
sidebar_position: 1
title: Features Overview
description: Complete guide to Alpaca features and capabilities
---

# Features Overview

Alpaca provides a comprehensive local AI chat experience with advanced features for power users and developers alike. This guide walks you through every feature available in the application.

## Chat Interface

The chat interface is the heart of Alpaca. It provides a modern, responsive messaging experience with support for rich content and advanced interactions.

### Starting a Conversation

1. **New Chat**: Click the **+** button in the sidebar or press `Ctrl+N`
2. **Select a Model**: Choose a loaded model from the model selector (in router mode)
3. **Type Your Message**: Enter text in the input box at the bottom
4. **Send**: Press `Enter` (or `Shift+Enter` for a new line)

### Message Types

Alpaca supports several message types:

| Type | Description | How to Use |
|------|-------------|------------|
| **Text** | Plain text messages | Type in the input box |
| **Code** | Syntax-highlighted code blocks | Wrap text in triple backticks (\`\`\`) |
| **Attachments** | Images, PDFs, text files | Drag & drop or paste into chat |
| **MCP Prompts** | Model Context Protocol prompts | Type `/` in the input box |

### Streaming Responses

Responses appear token-by-token in real time:

- Watch the AI think and type its response live
- The model name and generation statistics appear below the response
- Stop generation at any time by clicking the **Stop** button

### Conversation Branching

Every conversation is stored as a tree, enabling powerful branching:

- **Edit a Message**: Click the pencil icon. Choose to branch (create a new path) or replace (overwrite)
- **Regenerate**: Click the refresh icon to get a different response from the same prompt
- **Navigate Branches**: Use the left/right arrows to switch between alternative responses
- **Delete**: Remove a message and all its descendants

### File Attachments

Attach files to your messages for the AI to analyze:

**Supported File Types:**
- **Images** (PNG, JPG, GIF, WebP): Requires a vision-capable model
- **PDFs**: Extracted text is sent to the model
- **Text Files** (TXT, MD, CSV, JSON): Sent as plain text
- **Audio** (WAV): Requires an audio-capable model

**How to Attach:**
1. Drag and drop files onto the chat area
2. Click the paperclip icon in the input bar
3. Paste images directly from clipboard

### Voice Service (STT/TTS)

Alpaca includes built-in voice capabilities for hands-free interaction:

**Speech-to-Text (STT)**
- Click the **microphone icon** in the chat input bar to record audio
- Uses local **whisper.cpp** for transcription (auto-downloaded on first use)
- Transcribed text is inserted directly into the chat input

**Text-to-Speech (TTS)**
- Click the **speaker icon** on any assistant message to hear it read aloud
- Uses browser `speechSynthesis` by default (no setup required)
- Optionally configure a local **MOSS-TTS** server for higher quality voices

Enable/disable each service in **Settings** → **Voice**.

### Multi-Model Chat

Run multiple models simultaneously and compare their responses:

1. Open **Settings** → **Multi-Model**
2. Enable **Multi-Model Mode**
3. Enter comma-separated model IDs (e.g., `model-a,model-b`)
4. Choose a display mode:
   - **Comparison** — Side-by-side responses for the same query (comparison panel at the bottom)
   - **Parallel** — Independent conversation threads per model (navigate via branch arrows)
5. Send a message — all configured models respond simultaneously

:::info Router Mode Only
Multi-model chat requires the server to be in router mode with multiple models loaded.
:::

## Model Management

### Downloading Models

1. Open the **Models** panel from the sidebar
2. Browse the curated list or search HuggingFace
3. Click **Download** on your chosen model
4. Monitor progress in the download manager

### Loading and Switching Models

- **Click to Load**: Select a model to load it into memory
- **Auto-Switch**: In router mode, select the active model from the dropdown
- **Unload**: Right-click a loaded model and select **Unload** to free VRAM

### Model Information

View detailed information about any model:

- **Parameters**: Billions of parameters (e.g., 7B, 70B)
- **Quantization**: Q4_K_M, Q5_K_S, Q8_0, etc.
- **Context Length**: Maximum tokens the model can process
- **File Size**: Download size on disk
- **Modality**: Text, vision, audio support

### Custom Models

Import your own GGUF models:

1. Click **Import Model** in the Models panel
2. Select your `.gguf` file
3. Optionally attach a `.mmproj` file for vision models
4. The model appears in your local model list

## Settings and Configuration

Access settings via the gear icon in the top-right or `Ctrl+,`.

### General Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Theme** | Light, Dark, or System | System |
| **System Message** | Default behavior instruction | "You are a helpful assistant." |
| **Show System Messages** | Display system messages in chat | Off |
| **Title Generation** | Auto-name conversations | On |
| **Pre-encode Conversation** | Cache conversation for faster next turn | On |

### Sampling Parameters

Control how the model generates text:

| Parameter | Range | Description |
|-----------|-------|-------------|
| **Temperature** | 0.0 – 2.0 | Creativity/randomness (lower = more focused) |
| **Top P** | 0.0 – 1.0 | Nucleus sampling threshold |
| **Top K** | 0 – 100 | Limit to top K tokens |
| **Min P** | 0.0 – 1.0 | Minimum probability threshold |
| **Repeat Penalty** | 0.0 – 2.0 | Penalize repeated phrases |
| **Presence Penalty** | -2.0 – 2.0 | Encourage new topics |
| **Frequency Penalty** | -2.0 – 2.0 | Discourage token repetition |

### Penalty Parameters

Fine-tune repetition and diversity:

| Parameter | Description |
|-----------|-------------|
| **Repeat Last N** | Last N tokens to consider for repetition penalty |
| **Repeat Penalty** | Controls repetition of token sequences |
| **Presence Penalty** | Penalize tokens already present in output |
| **Frequency Penalty** | Penalize tokens based on appearance frequency |
| **DRY Multiplier** | DRY sampling repetition reduction strength |
| **DRY Base** | DRY sampling base value |
| **DRY Allowed Length** | Allowed match length for DRY |
| **DRY Penalty Last N** | DRY penalty window size |
| **DRY Sequence Breakers** | Comma-separated strings that reset DRY detection (e.g. `\n,.,!,?`) |

### Advanced llama.cpp Settings

For fine-grained control over generation:

| Parameter | Description |
|-----------|-------------|
| **Mirostat** | Adaptive perplexity control (modes 0, 1, 2) |
| **Mirostat Tau** | Target perplexity for mirostat |
| **Mirostat Eta** | Learning rate for mirostat |
| **Seed** | Random seed for reproducible outputs |
| **N Keep** | Tokens to keep from prompt when truncating |
| **N Discard** | Tokens to discard from input |
| **Ignore EOS** | Ignore end-of-sequence token |
| **Grammar** | Constrain output with formal grammar |
| **Grammar Lazy** | Enable lazy grammar evaluation |
| **Stop Sequences** | Custom strings that stop generation |
| **Logit Bias** | Adjust token probabilities (JSON object) |
| **N Probs** | Number of token probabilities to return |
| **Min Keep** | Minimum tokens to keep during sampling |
| **Top N Sigma** | Filter tokens by standard deviations from mean logit |
| **Post Sampling Probs** | Return probabilities after sampling |
| **Chat Format** | Override the chat format template |

### Reasoning Format

Control how models with chain-of-thought format their thinking:

| Setting | Effect |
|---------|--------|
| **Auto** | Extract thinking content into a separate field (default) |
| **None** | Keep thinking inline with the response text |
| **DeepSeek** | Use DeepSeek-style reasoning formatting |

Find this in **Settings** → **Developer** → **Reasoning Format**.

### Speculative Decoding

Speed up generation with a draft model (requires router mode with a loaded draft model):

| Parameter | Description |
|-----------|-------------|
| **Speculative N Max** | Maximum draft tokens to generate |
| **Speculative N Min** | Minimum draft tokens before acceptance |
| **Speculative P Min** | Minimum probability threshold for accepting draft tokens |

### LoRA Adapters

Apply Low-Rank Adaptation fine-tuned weights to a loaded model:

- Enter a JSON array in **Settings** → **Advanced** → **LoRA Adapters (JSON)**
- Format: `[{"name": "adapter-name", "scale": 1.0}]`
- The adapter file must be accessible to the llama-server

### API Settings

- **Server Port**: Change the default `13434` port
- **CORS**: Enable cross-origin requests
- **API Keys**: Manage authentication keys
- **Request Timeout**: Maximum wait time for responses

### Multi-Model Settings

- **Enable Multi-Model**: Toggle multi-model mode
- **Model IDs**: Comma-separated list of model identifiers
- **Display Mode**:
  - **Comparison** — Side-by-side responses for the same query
  - **Parallel** — Independent conversation threads per model

## System Tray and Background Operation

Alpaca can run in the background:

- **Minimize to Tray**: Close the window to keep the server running
- **Tray Menu**: Right-click the tray icon to:
  - Show/Hide the main window
  - Start/Stop the AI server
  - Open settings
  - Quit the application

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New conversation |
| `Ctrl+Shift+Backspace` | Delete current conversation |
| `Ctrl+Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Ctrl+,` | Open settings |
| `Ctrl+K` | Focus model selector |
| `/` | Open MCP prompt picker |
| `@` | Open MCP resource picker |
| `Esc` | Close dialogs/panels |

## MCP Integration

Model Context Protocol (MCP) enables the AI to use external tools and resources.

### MCP Prompts

Type `/` in the chat input to browse and select MCP prompts:

1. Connected MCP servers expose prompts
2. Search by name across all servers
3. Enter required arguments
4. The prompt is loaded into the conversation context

### MCP Resources

Type `@` in the chat input to attach MCP resources:

1. Browse available resources from connected servers
2. Click to attach to the current message
3. Resource content is included in the AI context

## Web Search

Enable web search for real-time information:

1. Open **Settings** → **Features** → **Web Search**
2. Toggle **Enable Web Search**
3. In chat, the AI can search DuckDuckGo when needed
4. Results are fetched and injected into the context

## Documentation Viewer

Access the built-in documentation site:

- **Menu**: Help → Documentation
- **Shortcut**: `Ctrl+Shift+D`
- Browse guides, API reference, and troubleshooting

## Import and Export

### Export Conversations

1. Open **Settings** → **Import/Export**
2. Click **Export All Conversations**
3. Choose a location for the JSON file

### Import Conversations

1. Open **Settings** → **Import/Export**
2. Click **Import Conversations**
3. Select a previously exported JSON file

## Agentic Mode

Enable agentic workflows for autonomous task execution:

1. Open **Settings** → **Agentic**
2. Toggle **Enable Agentic Mode**
3. The AI can now:
   - Call tools automatically
   - Execute multi-step reasoning
   - Delegate to sub-agents

:::caution Experimental
Agentic mode is an advanced feature. Review the [Agentic Services](../agentic/overview.md) documentation for details.
:::

## Backend Updates

Keep your llama.cpp backend up to date with the built-in update manager:

### Checking for Updates

1. Open **Settings** → **Providers**
2. Look at the **Local Backend (llama.cpp)** card
3. Click **Check for Updates** to query the latest release from GitHub
4. The card shows your current version and whether an update is available

### Installing an Update

When an update is available:

1. Click **Update to `<version>`** on the Local Backend card
2. A **progress bar** appears showing the current phase:
   - **Checking** — Querying the latest release
   - **Downloading** — Downloading the new backend binary (with percentage)
   - **Extracting** — Unpacking the downloaded archive
   - **Restarting** — Stopping and restarting the server with the new binary
   - **Ready** — Server is back online with the updated backend
3. A **toast notification** confirms when the server is ready
4. The chat window automatically reloads to reconnect to the restarted server

### What Happens During an Update

- The application downloads the correct backend for your hardware (CUDA, ROCm, Vulkan, or CPU)
- If the server was running, it is gracefully stopped and restarted
- Your conversations and settings are preserved
- The update runs entirely in the background; you can continue browsing settings

:::tip Automatic Hardware Detection
The update manager automatically detects your GPU and downloads the optimal backend. No manual selection is required.
:::

## Intelligent Scheduler & Multi-Slot Hosting

The v2.0.0 scheduler replaces the legacy "kill-and-restart" model switching with persistent runner processes and intelligent multi-slot hosting:

- **Zero-Cost Model Reuse** — Switch back to a recently used model instantly without reloading
- **Concurrent Multi-Model Hosting** — Keep multiple models in VRAM simultaneously on supported hardware
- **Intelligent Eviction** — When VRAM is full, the scheduler ranks candidates and evicts the least valuable model
- **Health Probing** — Each slot is monitored with quick health checks to ensure readiness
- **Lazy Start** — Models can be kept offline until first use, saving memory when idle

## VRAM Budget Manager

Advanced GPU memory management ensures stable multi-model operation:

- **Automatic VRAM Detection** — Detects total GPU memory and OS overhead at startup
- **Per-Model Estimation** — Estimates VRAM required for each model based on quantization, context size, and layer count
- **Budget Enforcement** — Prevents loading a model that would exceed available VRAM
- **Eviction Ranking** — Recommends which model to unload based on usage frequency, load time, and size
- **MoE Support** — Accurately estimates memory for Mixture-of-Experts models with inactive expert weights

## Backend Feature Detection

The app automatically probes your llama.cpp backend to discover supported features:

- **Turbo Quantization** — Detects `--type-k` / `--type-v` turbo types for faster KV cache
- **Speculative Decoding** — Enables draft-model acceleration when supported
- **Multi-Token Prediction (MTP)** — Uses MTP for faster generation on compatible backends
- **Flash Attention** — Automatically uses flash attention when available
- **Version Tracking** — Displays the current backend build tag (e.g., `b4082`)

## API Gateway

A unified HTTP/SSE proxy on port `13439` routes requests intelligently:

- **Slot-Aware Routing** — Automatically selects the correct model slot for each request
- **Cross-Slot Aggregation** — `/v1/models` and `/v1/slots/status` aggregate data across all active slots
- **Tool Call Rewriting** — Automatically rewrites tool call responses for compatibility
- **Grammar Injection** — Applies structured generation grammars on the fly
- **Streaming Support** — Full SSE streaming for chat completions across all slots
- **Image Generation** — `POST /v1/images/generations` and `GET /v1/images/status` for sd.cpp / Bonsai Image 4B
- **Desktop Model Management** — `/v1/desktop/*` endpoints mirror the Electron IPC handlers so the standalone webui can manage models via HTTP (with CORS support)

See the [REST API Reference](../api/rest-api.md) and [Tool Calling](../api/tool-calling.md) for endpoint details.

---

## Image Generation

Alpaca includes local image generation via **sd.cpp** and the **Bonsai Image 4B** model — no cloud dependencies.

- **Dedicated page**: Navigate to the **Image** page from the sidebar
- **Controls**: Prompt, steps, CFG, sampler, seed, width/height
- **Auto-download**: The Bonsai Image 4B model and sd-cli binary are downloaded automatically on first visit
- **Gallery**: Generated images are saved to a local folder and displayed in the gallery
- **API**: Available programmatically via `POST /v1/images/generations` on the API gateway

---

## Tool Calling (Function Calling)

Alpaca supports OpenAI-compatible tool calling, allowing the model to invoke structured tools during a conversation.

- **Protocol**: Standard OpenAI `tools` field on `/v1/chat/completions`
- **Streaming**: Tool-call arguments stream as incremental deltas (accumulated by index)
- **Tool rewriting**: The gateway automatically rewrites tool calls for local models that emit them as text
- **Built-in TUI tools**: The Terminal UI ships with `read_file`, `list_dir`, and `web_fetch` tools and an agentic loop that executes them locally

See the [Tool Calling](../api/tool-calling.md) documentation for the full protocol and external app integration examples.

---

## Terminal UI (TUI)

A Rust-based terminal user interface for chat and model management, inspired by the Claude Code CLI.

- **Streaming chat** with SSE and reasoning/thinking display
- **Slash commands**: `/help`, `/clear`, `/model`, `/models`, `/status`, `/system`, `/workspace`, `/quit`
- **Built-in tools**: `read_file`, `list_dir`, `web_fetch` with an agentic loop (up to 8 iterations)
- **Workspace**: Optional `--workspace <DIR>` for file context
- **Multi-line input** via `tui-textarea` (Shift+Enter for newline, Enter to send)
- **Scrollback** via PageUp/PageDown

### Launch
- **From the desktop app**: Tray menu → **Open Terminal UI**, or Settings → Providers → Terminal UI → **Launch**
- **Standalone**: `./alpaca-tui --control http://127.0.0.1:13439`

---

## Bonsai Model Catalog

Alpaca ships with a built-in catalog of Bonsai models that can be downloaded during onboarding or from the Models panel:

| Model | Type | Notes |
|-------|------|-------|
| **bonsai-27b** | Chat + Vision | Ternary Bonsai 27B; optional dspark drafter for speculative decoding |
| **bonsai-8b** | Chat | Ternary Bonsai 8B (lighter) |
| **bonsai-image-4b** | Image generation | For sd.cpp image generation |
| **bonsai-tts** | Text-to-speech | OuteTTS + WavTokenizer |
| **bonsai-stt** | Speech-to-text | Whisper large-v3 turbo |

The catalog mirrors the `bonsai-beach` configuration so the same models work across both projects.

## What's Next?

- **[Chat Interface Deep Dive](./chat-interface.md)** — Detailed chat usage
- **[Conversation Features](./conversation-features.md)** — Branching, editing, and regeneration
- **[Model Management](./model-management.md)** — Managing models
- **[Settings Guide](./settings.md)** — All configuration options
- **[API Management](../api-management/overview.md)** — External API providers
- **[Advanced Performance Tuning](../advanced/performance-tuning.md)** — Optimize for your hardware
- **[IPC Channels](../api/ipc-channels.md)** — Desktop API reference
