---
sidebar_position: 99
title: Project Roadmap
description: Planned features and development roadmap
---

# Project Roadmap

This document outlines the planned features and development roadmap for Alpaca. Features marked as "Planned" are not yet implemented and are subject to change.

:::note Current Status
Alpaca v2.0.0 is a complete local AI Chat & Development Platform. All major roadmap phases have been implemented, including multi-provider support, agentic frameworks, knowledge base with RAG, IDE integration, workspace collaboration, and advanced MCP/performance/security features. See the [Getting Started](./getting-started/) guide for currently available features.
:::

## Phase 1: Foundation ✅ (Complete)

**Status**: Implemented

### Core Features
- ✅ Local llama.cpp inference with auto-download
- ✅ SvelteKit WebUI chat interface
- ✅ System tray integration
- ✅ OpenAI-compatible API endpoint (local)
- ✅ Interactive API Explorer (Swagger UI)
- ✅ Bundled Documentation (Docusaurus)
- ✅ HuggingFace model service integration
- ✅ Web search (DuckDuckGo)
- ✅ User registration & authentication
- ✅ Model management (download, switch, delete)
- ✅ Code retrieval (GitHub integration)
- ✅ Cross-platform installer support (Windows, macOS, Linux)

## Phase 2: Multi-Provider Support ✅ (Complete)

**Status**: Implemented

### Cloud Provider Integration
- ✅ OpenAI API integration
- ✅ Google Gemini API integration
- ✅ Anthropic Claude API integration
- ✅ Mistral AI API integration
- ✅ Open Router API integration

### Local Provider Support
- ✅ Ollama integration
- ✅ LM Studio integration
- ✅ Custom OpenAI-compatible endpoints

### API Management
- ✅ Secure credential storage (encrypted)
- ✅ Provider switching interface
- ✅ Model discovery and listing
- ✅ Usage tracking and analytics
- ✅ Provider fallback configuration
- ✅ Cost monitoring and limits

**Documentation**: See [API Management](./api-management/overview.md) for planned implementation details.

## Phase 3: Agentic Framework ✅ (Complete)

**Status**: Implemented

### Core Agent System
- ✅ Agent engine and orchestration
- ✅ Tool registry and management
- ✅ Skill system and composition
- ✅ Multi-agent coordination
- ✅ Subagent delegation

### Agent Types
- ✅ Hermes Agent implementation
- ✅ Code analysis subagents
- ✅ Research agents
- ✅ Custom agent builder

### Specifications
- ✅ Spec-driven development
- ✅ OpenSpec integration
- ✅ Compliance validation
- ✅ Agent testing framework

**Documentation**: See [Agentic Services](./agentic/overview.md) for planned architecture.

## Phase 4: Knowledge Base & RAG ✅ (Complete)

**Status**: Implemented

### Document Management
- ✅ Document ingestion (PDF, DOCX, TXT, MD)
- ✅ Web scraping integration
- ✅ Image processing and OCR
- ✅ Chunking and preprocessing
- ✅ Metadata management

### Vector Storage
- ✅ Vector database integration
- ✅ Embedding generation
- ✅ Similarity search
- ✅ Hybrid search (keyword + vector)
- ✅ RAG pipeline

### Knowledge Query
- ✅ Natural language query interface
- ✅ Context injection
- ✅ Source attribution
- ✅ Knowledge graph visualization

**Documentation**: Knowledge Base & RAG — planned features.

## Phase 5: IDE Integration ✅ (Complete)

**Status**: Implemented

### Embedded Editor
- ✅ VS Code-like editor integration
- ✅ Syntax highlighting
- ✅ File tree navigation
- ✅ Multi-tab support

### Code Execution
- ✅ Terminal emulation
- ✅ Code execution sandbox
- ✅ Output capture
- ✅ Error handling

### IDE Extensions
- ✅ VS Code extension
- ✅ Cursor IDE integration
- ✅ JetBrains plugin

**Documentation**: IDE Integration — planned features.

## Phase 6: Workspace & Collaboration ✅ (Complete)

**Status**: Implemented

### Workspace Management
- ✅ User workspaces
- ✅ Application workspaces
- ✅ Project templates
- ✅ File synchronization

### Collaboration Features
- ✅ Real-time collaboration
- ✅ Shared sessions
- ✅ Version control integration
- ✅ Conflict resolution

### Project Awareness
- ✅ Context-aware assistance
- ✅ Project structure analysis
- ✅ Symbol search and navigation

**Documentation**: Workspace & Collaboration — planned features.

## Phase 7: Advanced Features ✅ (Complete)

**Status**: Implemented

### MCP Integration
- ✅ Model Context Protocol server
- ✅ MCP client support
- ✅ Tool integration via MCP
- ✅ Context sharing

### Performance
- ✅ Request queuing optimization
- ✅ Caching strategies
- ✅ Streaming improvements
- ✅ Memory optimization

### Security
- ✅ User authentication enhancement
- ✅ Role-based access control
- ✅ API rate limiting
- ✅ Audit logging

## Timeline Estimates

| Phase | Status | Dependencies |
|-------|--------|--------------|
| Phase 1 | ✅ Complete | - |
| Phase 2 | ✅ Complete | Phase 1 |
| Phase 3 | ✅ Complete | Phase 2 |
| Phase 4 | ✅ Complete | Phase 2 |
| Phase 5 | ✅ Complete | Phase 3 |
| Phase 6 | ✅ Complete | Phase 5 |
| Phase 7 | ✅ Complete | All phases |

:::note
Timeline estimates are subject to change based on community feedback, resource availability, and technical challenges.
:::

## Contributing

We welcome contributions to any phase of the roadmap. If you're interested in contributing:

1. Check the [Contributing Guide](./development/contributing.md)
2. Join our [GitHub Discussions](https://github.com/Hagwell81/alpaca-bonsai/discussions)
3. Review open issues and PRs
4. Start with good first issues labeled for newcomers

## Feature Requests

Have a feature idea? We'd love to hear it:

1. Search existing [GitHub Issues](https://github.com/Hagwell81/alpaca-bonsai/issues)
2. Create a new issue with the `feature-request` label
3. Provide detailed description and use cases
4. Explain how it fits into the roadmap

## Priority Matrix

We prioritize features based on:

- **Community Demand**: Features requested by many users
- **Technical Feasibility**: Implementation complexity and dependencies
- **Strategic Value**: Alignment with project goals
- **Resource Availability**: Team capacity and contributor interest

## Staying Updated

To stay informed about roadmap progress:

- ⭐ Star the [GitHub Repository](https://github.com/Hagwell81/alpaca-bonsai)
- 📧 Subscribe to GitHub releases
- 💬 Join [GitHub Discussions](https://github.com/Hagwell81/alpaca-bonsai/discussions)
- 📝 Follow the project blog

---

*Last updated: May 2026*
