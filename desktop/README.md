# Llama.cpp Desktop Application

A desktop application wrapper for llama.cpp that provides:
- System tray integration with background operation
- Automatic model downloads on first run
- Windows installer support
- Easy access to the llama.cpp WebUI
- Secure encrypted storage for API keys and tokens
- Performance optimizations for faster startup and model loading
- Advanced HuggingFace model service with vision model support

## Features

### Core Features
- **System Tray**: Minimize to tray, restore from tray, quit from tray
- **First-run setup screen**: Pick from a curated list of GGUF models, or paste any HuggingFace repo (`author/model-name`) to download a custom model. Optional HF token field for gated repos.
- **Background Server**: Automatically starts llama-server in background
- **Windows Installer**: NSIS-based installer for easy deployment

### Pre-Dev Enhancements (v1.1.0+)

#### Secure Data Storage
- **Secret_Vault**: Encrypted storage for API keys and HuggingFace tokens using AES-256-GCM
- **Machine-Bound Keys**: Keys derived from platform-specific identifiers prevent cross-machine secret theft
- **Automatic Migration**: Existing data automatically encrypted on first run
- **Cross-Machine Detection**: SHA-256 checksums detect if secrets are used on different machines

#### Performance Optimizations
- **Warm-Cache**: LRU cache with 3 models reduces model load time by ~40%
- **Connection Pooling**: HTTP connection reuse reduces latency by ~50ms per request
- **Request Batching**: Coalesces embedding requests, reducing API calls by 10-100x
- **Lazy Tensor Loading**: Deferred tensor initialization reduces initial RAM spike
- **Startup Telemetry**: Track and optimize startup performance with 30-day trend analysis

#### HuggingFace Model Service
- **Resumable Downloads**: HTTP Range support for interrupted downloads
- **Hash Verification**: SHA-256 verification prevents corrupted files
- **Vision Model Detection**: Automatic detection and pairing of multimodal models
- **Quantization Matching**: Intelligent matching of base and vision model quantizations
- **Retry Logic**: Automatic retry with exponential backoff for transient failures

## Prerequisites

1. Build llama.cpp with llama-server
2. Build the webui: `cd tools/server/webui && npm run build`
3. Install Node.js dependencies in this directory

## Quick Start

### First Time Users

1. **Install the app:**
   - Windows: Download `Alpaca-Setup-1.1.0.exe` and run installer
   - macOS: Download `Alpaca-1.1.0-macOS.dmg` and drag to Applications
   - Linux: Download `.AppImage` or `.deb` and install

2. **Launch the app:**
   - App will show setup screen on first run
   - Select models to download or search HuggingFace
   - Add HuggingFace token if needed (for gated repos)

3. **Wait for download:**
   - First model download may take 5-30 minutes depending on model size
   - App will start llama-server automatically when done

4. **Start chatting:**
   - WebUI opens automatically
   - Start chatting with your local model

### Existing Users Upgrading

1. **Backup your data** (optional but recommended):
   - Windows: `xcopy %APPDATA%\alpaca %APPDATA%\alpaca.backup /E /I`
   - macOS/Linux: `cp -r ~/.config/alpaca ~/.config/alpaca.backup`

2. **Install new version:**
   - Follow installation steps above

3. **First run - Migration:**
   - App will show migration dialog
   - Click "Migrate" to encrypt existing data
   - Migration takes 1-2 minutes

4. **Verify everything works:**
   - Check Settings → Models to verify models are accessible
   - Test loading a model
   - Check Settings → API Keys to verify secrets are stored

See [Migration Guide](./docs/migration-guide.md) for detailed instructions.

## Installation

```bash
cd tools/server/desktop
npm install
```

## Development

```bash
npm start
```

## Building

```bash
# Build Windows installer
npm run build:installer

# Build portable executable
npm run build:portable

# Build both
npm run build
```

## First Run

On first run, the app will:
1. Show a setup screen with two ways to obtain a model:
   - Tick one or more curated GGUF models from the list and click **Download Selected**.
   - Paste any HuggingFace repo id (e.g. `bartowski/Llama-3.2-3B-Instruct-GGUF`) into the HuggingFace search box, click **Search**, then **Download** the file you want. Add a HuggingFace token if the repo is gated.
2. Once the first download completes, the app starts `llama-server` with that model and switches to the WebUI automatically.
3. Models are stored in `%APPDATA%/alpaca/models/` (Windows) or `~/.config/alpaca/models/` (macOS/Linux).

## Built-in Code Retrieval with jCodeMunch

The app includes an embedded **jCodeMunch** client for structured code retrieval directly from the Electron main process — no separate MCP server configuration required. It works for both web search results and local workspace folders.

### Prerequisites (End Users — No Setup Required)

When the app is **packaged with the bundled jCodeMunch binary**, no Python installation is required. The app auto-detects the bundled executable on startup.

### Prerequisites (Development / Source Builds)

If the bundled binary is not present, the app falls back to system Python:

1. Install Python 3.10+ and jcodemunch-mcp:
   ```bash
   pip install jcodemunch-mcp
   ```
2. The app auto-detects Python and the package on startup.

### Bundling the Standalone Binary (for Distribution)

To build a self-contained app with zero external dependencies:

1. Ensure Python 3.10+ is on your PATH.
2. From the desktop directory, run:
   ```bash
   npm run build:jcm
   ```
   This invokes PyInstaller to bundle jcodemunch-mcp into a single executable and places it in `desktop/bin/`.
3. Build the Electron app as usual:
   ```bash
   npm run build
   ```

The resulting installer/portable executable includes the jCodeMunch binary, so end users do not need Python installed.

### Web Search → GitHub Code Context

The Web Search dialog (globe icon in the chat toolbar) supports DuckDuckGo search and page fetching. When jCodeMunch is available, search results that link to GitHub repositories gain a **Code** button:

1. Click the **Code** button on a GitHub result to index the repository
2. The dialog searches the repo for symbols matching your original query
3. Click any symbol to fetch its exact source code
4. Add structured code context to your chat instead of raw HTML

### Local Workspace Folders

Switch to the **Local Workspace** tab in the search dialog to:

1. Click **Select Folder** to browse and index any local project folder
2. Indexed folders appear as searchable repositories
3. Search for symbols across your own codebase using natural language queries
4. Retrieve exact source code for functions, classes, methods, etc.
5. Add precise code context to the chat for AI-assisted development

> **Tip**: jCodeMunch indexes code locally using tree-sitter AST parsing and retrieves exact symbol source via byte offsets. Indexed data is stored in `%APPDATA%/alpaca/jcodemunch/` (Windows) or `~/.config/alpaca/jcodemunch/` (macOS/Linux).

## System Tray Menu

- **Show Llama.cpp**: Restore the main window
- **Server Status**: View and control llama-server
- **Download Models**: Manually trigger model downloads
- **Quit**: Close the application

## Model Downloads

The curated list points to verified `bartowski/*-GGUF` repos on HuggingFace covering Qwen, Llama, Gemma, Mistral, Phi and SmolLM2 (see `MODELS_TO_DOWNLOAD` in `main.js`). For anything else, use the HuggingFace search box on the setup screen or in **Settings → Models** inside the WebUI.

Downloaded models are stored in:
- Windows: `%APPDATA%/alpaca/models/`
- macOS/Linux: `~/.config/alpaca/models/`

## Troubleshooting

### llama-server binary not found
Ensure llama.cpp has been built and the llama-server binary exists in the build directory.

### Models not downloading
Check your internet connection and Hugging Face accessibility.

### WebUI not loading
Ensure the webui has been built: `cd tools/server/webui && npm run build`

## Documentation

- **[Pre-Dev Enhancements Guide](./docs/pre-dev-enhancements.md)** - Comprehensive documentation for all new features
- **[Migration Guide](./docs/migration-guide.md)** - Step-by-step guide for upgrading from previous versions
- **[Troubleshooting Guide](./docs/troubleshooting.md)** - Solutions for common issues
- **[API Reference](./docs/pre-dev-enhancements.md#api-reference)** - Complete API documentation

### Feature Documentation

- **[Secure Data Storage](./docs/pre-dev-enhancements.md#secure-data-storage-layer)** - Secret_Vault, Key_Derivation, User_Migration
- **[HuggingFace Model Service](./docs/pre-dev-enhancements.md#huggingface-model-service)** - Model downloads, vision pairing, resumable downloads
- **[Performance Optimizations](./docs/pre-dev-enhancements.md#performance-optimizations)** - Connection pooling, request batching, warm-cache, startup telemetry

## File Structure

```
desktop/
├── main.js           # Electron main process
├── preload.js        # Preload script for security
├── package.json      # Node.js dependencies and scripts
├── resources/        # Icons and assets
├── public/           # Built webui (copied from ../public)
└── models/           # Downloaded models (in userData directory)
```
