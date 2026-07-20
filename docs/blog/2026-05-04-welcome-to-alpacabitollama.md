---
slug: welcome-to-alpaca
title: Welcome to Alpaca — The Road Ahead
authors: [tom]
tags: [announcement, roadmap, getting-started]
---

We are excited to introduce **Alpaca**, a comprehensive open-source local AI platform that brings together chat, development tools, and agentic services in a unified desktop application. This post outlines where we are today and the ambitious roadmap that will take us from a local chat application to a full-featured AI development platform over the next nine to ten months.

<!-- truncate -->

## What is Alpaca?

Alpaca is designed for developers and AI enthusiasts who want to run large language models locally without compromising on features. Built on top of **llama.cpp**, it provides a modern, intuitive interface for interacting with LLMs while keeping your data on your own hardware.

### Current Capabilities

- **Local Model Execution** — Run models directly on your hardware with automatic backend selection (CUDA, ROCm, Vulkan, or CPU)
- **Multi-Provider Support** — Seamlessly switch between local inference and cloud providers including OpenAI, Google Gemini, Anthropic Claude, Mistral, and Open Router
- **Privacy-First Design** — Your conversations and data never leave your machine unless you explicitly choose a cloud provider
- **Desktop-Native Experience** — System tray integration, offline documentation, keyboard shortcuts, and a responsive web-based UI
- **Cross-Platform** — Native support for Windows, macOS, and Linux with automatic hardware capability detection

## The Road Ahead: Eight Phases to a Full AI Platform

Our roadmap is structured in eight phases, each delivering incremental value while building toward a comprehensive AI development environment.

### Phase 1: Documentation Site ✅

The foundation of any great project is great documentation. We have built a Docusaurus-powered documentation site with offline access, full-text search, dark mode support, and keyboard shortcuts — all integrated directly into the desktop application.

**Status:** Complete and shipping with the current release.

### Phase 2: API Management Service (Weeks 3–6)

A unified credential management system for multiple AI providers is next. This phase will deliver:

- **Provider Registry** — Structured definitions for every supported provider with capability metadata and model information
- **Credential Manager** — Encrypted API key storage with key rotation and access logging
- **Model Selector** — Automatic model discovery, capability matching, and performance optimization
- **Request Router** — Intelligent provider selection with fallback handling and load balancing

Supported providers will include OpenAI, Google, Anthropic, Mistral, Open Router, Ollama, LM Studio, Azure Foundry, and custom OpenAI-compatible endpoints.

### Phase 3: Knowledge Base & RAG Integration (Weeks 7–11)

Transforming Alpaca into a research and knowledge platform:

- **Web Scraper (Archon)** — Advanced web and GitHub scraping with link extraction and content parsing
- **Document Processor** — PDF extraction, Markdown parsing, code block extraction, and metadata preservation
- **Image Processor** — OCR integration with Tesseract, image analysis, and diagram extraction
- **Vector Store** — Local embeddings with sentence-transformers, stored in Chroma or Weaviate, with semantic similarity search
- **MCP Service** — Model Context Protocol implementation for exposing knowledge base tools to agents

### Phase 4: Multi-Agentic Service (Weeks 12–19)

The heart of the platform: multi-agent orchestration with subagent delegation.

- **Hermes Agent** — Full reasoning capabilities, multi-step planning, tool orchestration, and context management
- **Code Subagents** — Specialized agents for code generation, review, bug detection, performance optimization, and documentation generation
- **Tool System** — A registry of 100+ tools across web, code, file, database, API, and system categories
- **Skill System** — Composable, versioned, and discoverable skills that agents can combine dynamically
- **Spec System** — Specification-driven development with compliance checking and validation

### Phase 5: Workspace & Collaboration (Weeks 20–23)

Organizing your AI work into structured workspaces:

- **User Workspace** — Project creation, file organization, settings persistence, and history tracking
- **App Workspace** — Agent libraries, tool configurations, skill libraries, and specification templates
- **Collaboration** — Real-time file synchronization, conflict resolution, access control, and activity tracking
- **Storage Management** — Local filesystem storage with optional cloud sync, version control integration, and backup management

### Phase 6: Desktop App Enhancements (Weeks 24–27)

Polishing the user experience with a modern design system inspired by Claude Code, open-codesign, and kuse_cowork:

- Modern responsive layout with dark and light mode
- Enhanced tray menu with quick settings and status indicators
- Improved documentation viewer with full-text search
- Project management with templates and recent project tracking

### Phase 7: IDE Integration (Weeks 28–35)

Bringing a fully-featured IDE into the platform:

- **Monaco Editor** — VS Code-like editing with syntax highlighting, code completion, and refactoring
- **Copilot Integration** — AI-powered code suggestions, explanations, debugging assistance, and documentation generation
- **Terminal Emulation** — xterm.js-powered terminal with shell integration and command history
- **Project Explorer** — File tree, search, symbol navigation, and outline view
- **Debugger** — Breakpoint management, step execution, variable inspection, and call stack view

### Phase 8: Testing & Optimization (Weeks 36–41)

The final phase focuses on quality, performance, and security:

- Comprehensive unit, integration, end-to-end, and performance testing
- Request caching, database indexing, code splitting, and asset optimization
- Input validation, output sanitization, API key protection, and access control
- Error handling, retry logic, fallback mechanisms, and health monitoring

## Why Alpaca?

The AI tooling landscape is fragmented. You have chat interfaces, code assistants, knowledge bases, and agent frameworks — each requiring separate accounts, separate data handling policies, and separate workflows. Alpaca unifies these into a single, local-first platform where **you own your data** and **you control your tools**.

Whether you are a researcher building knowledge bases, a developer writing code with AI assistance, or a power user orchestrating multi-agent workflows, Alpaca is designed to adapt to your needs while keeping everything under your control.

## Get Involved

We are building Alpaca in the open and welcome community contributions:

- [GitHub Repository](https://github.com/Hagwell81/alpaca-bonsai)
- [GitHub Discussions](https://github.com/Hagwell81/alpaca-bonsai/discussions)
- [Issue Tracker](https://github.com/Hagwell81/alpaca-bonsai/issues)

Download the latest release, try it out, and let us know what you think. The journey from a local chat app to a full AI development platform starts with a single conversation.

---

*Alpaca is open-source software licensed under the MIT License. Built with llama.cpp, Docusaurus, Electron, and a lot of enthusiasm for local AI.*
