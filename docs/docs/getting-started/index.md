---
sidebar_position: 1
title: Welcome to Alpaca
description: Local AI Chat & Development Platform
---

# Welcome to Alpaca

**Alpaca** is a user-friendly desktop application that brings the power of local LLM inference to everyday users through an intuitive chat interface built on top of llama.cpp.

## What is Alpaca?

Alpaca is a powerful, open-source desktop application designed for developers and AI enthusiasts who want to:

- **Chat with Local AI Models** - Run LLMs locally with support for GGUF models
- **Manage Models Easily** - Download, switch, and manage models from HuggingFace
- **Multi-Model Chat** - Run multiple models simultaneously in comparison or parallel mode
- **Web Search Integration** - Built-in DuckDuckGo search for context
- **Voice Interaction** - Speech-to-text (whisper.cpp) and text-to-speech support
- **Code Retrieval** - Index and search GitHub repositories
- **OpenAI-Compatible API** - Expose local models via standard API endpoint
- **Multi-Provider Support** - Connect to OpenAI, Anthropic, Google, Mistral, Ollama, LM Studio, and more
- **Agentic Framework** - Build multi-agent systems with tool orchestration
- **Knowledge Base & RAG** - Document ingestion, vector storage, and hybrid search
- **System Tray Integration** - Run in the background with easy access
- **Bundled Documentation** - Built-in Docusaurus docs site accessible offline

:::info v2.0.0 Now Available
Alpaca v2.0.0 delivers the complete platform with multi-provider support, agentic systems, knowledge base with RAG, IDE integration, workspace collaboration, and advanced MCP/performance/security features. See the [Project Roadmap](../roadmap.md) for details.
:::

## Key Features

### 🤖 Local LLM Inference
- Built on llama.cpp for efficient local inference
- Automatic hardware detection (CUDA, ROCm, Vulkan, CPU)
- Auto-download of correct backend binaries
- Support for GGUF models from HuggingFace
- Vision/multimodal support via mmproj files

### 💬 Modern Chat Interface
- SvelteKit-based web UI
- Real-time streaming responses
- Message history and context management
- Markdown rendering with syntax highlighting
- Copy-to-clipboard for code and messages

### 📦 Model Management
- Curated model list (Qwen, Llama, Gemma, Mistral, Phi, SmolLM2, Bonsai)
- Search any HuggingFace GGUF repository
- Active model switching without restart
- Model download progress tracking

### � Web Search
- DuckDuckGo integration for web search
- Automatic page content fetching
- Text extraction from HTML
- Context injection into conversations

### 🔧 Code Retrieval
- Index GitHub repositories from search results
- Browse local workspace folders
- Search symbols (functions, classes, methods)
- Retrieve source code with byte-accurate offsets

### 🌐 OpenAI-Compatible API
- Exposes `http://127.0.0.1:13434/v1` for IDE integrations
- Interactive API Explorer (Swagger UI)
- Chat completions endpoint
- Models listing endpoint
- Health check endpoint

### 📚 Bundled Documentation
- Built-in Docusaurus documentation site
- API reference and guides
- Troubleshooting documentation
- Accessible from within the app

### 👤 User System
- Local user registration
- SHA-256 password hashing
- User profiles and settings
- Secure data storage

### ⚡ Performance Optimized
- Intelligent scheduler with multi-slot model hosting
- VRAM budget manager for GPU memory optimization
- Backend feature detection (turbo quant, speculative decoding, flash attention)
- Circuit breaker pattern for resilience
- Request queuing and concurrency management
- Streaming heartbeat detection
- Health monitoring and metrics
- Persistent splash screen and lazy-start server

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca-bonsai

# Install dependencies
npm install

# Start the application
npm start
```

### First Steps

1. **Launch the Application** - Start Alpaca from your applications menu
2. **Configure AI Provider** - Add your first API key (optional for local models)
3. **Download a Model** - Select and download a local model
4. **Start Chatting** - Begin conversations with your AI model
5. **Explore Features** - Try agents, tools, and workspace features

## System Requirements

- **OS**: Windows 10+, macOS 11+, Linux (Ubuntu 20.04+)
- **RAM**: 8GB minimum (16GB+ recommended)
- **Disk**: 10GB for models and application
- **GPU**: Optional (NVIDIA, AMD, or Intel Arc supported)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Desktop Application                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Chat Interface | Settings | Documentation       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐    ┌─────▼──────┐   ┌────▼────┐
   │ Chat    │    │   Model    │   │  API    │
   │ Service │    │  Manager   │   │ Server  │
   └────┬────┘    └─────┬──────┘   └────┬────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐    ┌─────▼──────┐   ┌────▼────┐
   │ llama   │    │  Hugging   │   │  Web    │
   │ .cpp    │    │   Face     │   │ Search  │
   └─────────┘    └────────────┘   └─────────┘
```

## Core Components

### Chat Service
Real-time chat with streaming support, message history, and context management.

### Model Manager
Download, switch, and manage GGUF models from HuggingFace and other sources.

### API Server
OpenAI-compatible API endpoint for IDE integrations and third-party tools.

### System Tray
Background service with tray menu for easy access and control.

### Documentation Viewer
Built-in Docusaurus documentation site for guides and API reference.

## What's Next?

- **[Installation Guide](./installation.md)** - Detailed setup instructions
- **[Quick Start](./quickstart.md)** - Get up and running in 5 minutes
- **[User Guide](../user-guide/chat-interface.md)** - Learn the interface
- **[API Reference](../api/rest-api.md)** - API documentation
- **[Development](../development/architecture.md)** - Start building
- **[Project Roadmap](../roadmap.md)** - See planned features

## Community & Support

- **GitHub**: [Hagwell81/alpaca-bonsai](https://github.com/Hagwell81/alpaca-bonsai)
- **Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Documentation**: Comprehensive guides and API reference

## License

Alpaca is open-source software licensed under the MIT License.

---

Ready to get started? Head to the [Installation Guide](./installation.md)!
