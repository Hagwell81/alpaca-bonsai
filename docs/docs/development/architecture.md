---
sidebar_position: 1
title: Architecture Overview
description: System architecture and component design
---

# Architecture Overview

## System Architecture

Alpaca is built on a modular, layered architecture focused on local LLM inference with llama.cpp:

:::note Planned Features
This documentation describes the current implementation. For planned features like multi-provider support, agentic framework, knowledge base with RAG, and IDE integration, see the [Project Roadmap](../roadmap.md).
:::

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                       │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Chat UI      │ Settings     │ Documentation Viewer     │ │
│  │ (SvelteKit)  │ (SvelteKit)  │ (Docusaurus)             │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Chat Service │ Model Manager│ API Server               │ │
│  │              │              │ (OpenAI-compatible)      │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Integration Layer                        │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Binary Mgr   │ Web Search   │ Code Retrieval           │ │
│  │ (llama.cpp)  │ (DuckDuckGo) │ (GitHub)                 │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Services Layer                           │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Local Models │ HuggingFace  │ User Data                │ │
│  │ (llama.cpp)  │ Model Hub    │ (electron-store)         │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Desktop Application (Electron)

**Location**: `desktop/`

**Responsibilities**:
- Window management
- IPC communication with renderer
- File system access
- Process management (llama.cpp server)
- Tray menu and system integration
- Lazy-start server management

**Key Files**:
- `main.js` - Main process entry point
- `api-server.js` - API server configuration
- `request-manager.js` - Request queue and circuit breaker
- `binary-manager.js` - Auto-download llama.cpp backends
- `splash-manager.js` - Splash screen IPC updates
- `lazy-start-manager.js` - On-demand server start
- `preload.js` - IPC channel exposure

### 2. Web UI (SvelteKit)

**Location**: `webui/`

**Responsibilities**:
- Chat interface
- Settings and configuration
- Model management
- Real-time updates via SSE
- User authentication

**Key Files**:
- `src/lib/services/chat.service.ts` - Chat API communication
- `src/lib/stores/chat.svelte.ts` - Chat state management
- `src/routes/` - Page routes

### 3. llama.cpp Integration

**Location**: `desktop/binary-manager.js`

**Responsibilities**:
- Hardware detection (CUDA, ROCm, Vulkan, CPU)
- Backend binary auto-download from GitHub releases
- DLL verification (Windows)
- CUDA runtime download (if needed)
- Backend management and updates

**Based on**:
- ggml-org/llama.cpp releases
- Automatic hardware detection
- Cross-platform binary support

### 4. Model Management

**Location**: Web UI + llama.cpp

**Responsibilities**:
- Curated model list from HuggingFace
- Search any HuggingFace GGUF repository
- Model download progress tracking
- Active model switching
- Model metadata (size, quantization, context)

**Supported Models**:
- Qwen, Llama, Gemma, Mistral, Phi, SmolLM2, Bonsai
- Vision models with mmproj support
- Custom GGUF models

### 5. API Server

**Location**: `desktop/api-server.js`

**Responsibilities**:
- OpenAI-compatible API endpoint (`http://127.0.0.1:13434/v1`)
- Chat completions
- Model listing
- Health checks
- Token counting
- Request queue management

**Features**:
- Circuit breaker pattern
- Request queuing
- Streaming support (SSE)
- Health monitoring

### 6. Web Search Integration

**Location**: Web UI

**Responsibilities**:
- DuckDuckGo search integration
- Page content fetching
- HTML text extraction
- Context injection into chat

### 7. Code Retrieval

**Location**: Web UI

**Responsibilities**:
- GitHub repository indexing
- Local workspace browsing
- Symbol search (functions, classes, methods)
- Source code retrieval with byte offsets

### 8. Documentation Site

**Location**: `docs/` (Docusaurus)

**Responsibilities**:
- Comprehensive documentation
- API reference
- Guides and tutorials
- Built-in viewer in desktop app

## Data Flow

### Chat Request Flow

```
User Input
    │
    ▼
Chat UI (SvelteKit)
    │
    ▼
Chat Service (IPC)
    │
    ▼
API Server
    │
    ├─ Check model status
    ├─ Queue request
    │
    ▼
llama.cpp Server
    │
    ▼
Response Stream (SSE)
    │
    ▼
Chat UI (Update)
    │
    ▼
User Sees Response
```

### Model Download Flow

```
User Selects Model
    │
    ▼
Model Manager
    │
    ├─ Check HuggingFace
    ├─ Download GGUF
    │
    ▼
Binary Manager
    │
    ├─ Detect hardware
    ├─ Download backend
    │
    ▼
llama.cpp Server
    │
    ▼
Model Loaded
```

## IPC Channels

### Chat Operations
- `send-message` - Send chat message
- `get-chat-history` - Retrieve conversation history
- `clear-chat` - Clear current conversation

### Model Management
- `get-models` - List available models
- `download-model` - Download model from HuggingFace
- `switch-model` - Switch active model
- `delete-model` - Delete model from disk

### Server Control
- `start-server` - Start llama.cpp server
- `stop-server` - Stop llama.cpp server
- `restart-server` - Restart llama.cpp server
- `get-server-status` - Get server status

### Health & Monitoring
- `api:health` - Server health check
- `api:count-tokens` - Estimate token count
- `api:queue-status` - Request queue status

### Backend Management
- `get-installed-backends` - List cached backend versions
- `check-for-backend-update` - Query latest llama.cpp release from GitHub
- `get-current-backend-info` - Get currently active backend tag and path
- `update-backend` - Download latest backend and restart server if running
- `backend-update-progress` (event) - Real-time progress broadcasts:
  - `phase`: `checking` | `downloading` | `extracting` | `restarting` | `ready` | `error`
  - `progress`: 0-100 percentage during download
  - `message`: Human-readable status description

### System Tray
- `show-window` - Show main window
- `hide-window` - Hide main window
- `quit-app` - Quit application

## Configuration

### Application Config
Located in user data directory:
- Windows: `%APPDATA%/alpaca/`
- macOS: `~/.config/alpaca/`
- Linux: `~/.config/alpaca/`

**config.json** (electron-store):
```json
{
  "apiServer": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 13434,
    "cors": true,
    "requestTimeout": 300000,
    "maxConcurrentRequests": 10
  },
  "lazyStart": {
    "enabled": true
  },
  "models": {
    "defaultModel": "llama-3-8b",
    "downloadPath": "models"
  }
}
```

## Performance Optimizations

### Request Management
- **Circuit Breaker**: Prevents cascading failures
- **Request Queue**: Manages concurrency
- **Heartbeat Detection**: Detects unresponsive servers
- **Lazy-Start**: Delayed server start to reduce RAM usage

### Streaming
- **Chunked Processing**: Process data as it arrives
- **SSE (Server-Sent Events)**: Real-time response streaming
- **Error Recovery**: Graceful error handling

### Splash Screen
- **Persistent Splash**: Single splash screen during startup
- **IPC Updates**: Progress updates via IPC
- **Smooth Transitions**: No black flashes during startup

## Security

### User Data
- SHA-256 password hashing
- Local-only data storage
- No external data transmission

### Communication
- Local-only for llama.cpp server
- IPC for inter-process communication
- User authentication for local access

## Extensibility

### Adding Model Sources
1. Extend model manager with new HuggingFace repositories
2. Add model metadata parsing
3. Update UI to display new models

### Adding Backend Support
1. Update binary-manager.js for new hardware
2. Add backend detection logic
3. Configure download URLs

## Next Steps

- **[Build System](./build-system.md)** - Build and deployment
- **[Contributing](./contributing.md)** - Contribution guidelines
- **[API Reference](../api/rest-api.md)** - API documentation
- **[Project Roadmap](../roadmap.md)** - Planned features
