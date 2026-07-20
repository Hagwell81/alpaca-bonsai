# Alpaca Integrations

Alpaca integrates with a wide range of third-party tools through its multi-protocol API. The gateway on port `13439` speaks three protocol families, so any tool that supports OpenAI, Anthropic, or Ollama can connect without a shim.

## API Endpoints

| Layer | URL | Compatible With |
|-------|-----|----------------|
| OpenAI-compatible | `http://localhost:13439/v1` | OpenAI SDK, Continue, Cursor, Copilot Chat, Codex, Cline, OpenCode, Goose, Pi, Pool, Zed, JetBrains, Xcode, Onyx, n8n, marimo |
| Anthropic-compatible | `http://localhost:13439` (endpoint: `/v1/messages`) | Claude Code, Anthropic SDK |
| Ollama-compatible | `http://localhost:13439/api` | Any Ollama-native client (Ollama SDK, `ollama` CLI integrations) |

All endpoints require **no authentication** by default, but some clients require an API key — use `alpaca` or `ollama` as the value.

:::note Ollama Compatibility
Alpaca implements the full Ollama HTTP API (`/api/tags`, `/api/chat`, `/api/generate`, `/api/show`, `/api/version`, `/api/ps`, `/api/embed`). Any tool that connects to Ollama by setting `OLLAMA_HOST=http://localhost:11434` can be pointed at Alpaca by changing the host to `http://localhost:13439`. See the [REST API Reference](./api/rest-api.md#ollama-compatible-endpoints-gateway-only) for the full endpoint list.
:::

---

## Coding Agents (10)

### Claude Code
Anthropic's agentic coding tool.

```bash
export ANTHROPIC_BASE_URL=http://localhost:13439
export ANTHROPIC_API_KEY=""
export ANTHROPIC_AUTH_TOKEN=alpaca
claude --model <your-model>
```

**Requirements:** 64k+ context window.

### Codex App
OpenAI's desktop coding agent for macOS and Windows.

1. Install Codex App
2. Set base URL to `http://localhost:13439/v1` and API key to `alpaca`
3. Requires 64k+ context window

### Codex CLI
OpenAI's CLI coding assistant.

```bash
# Quick mode
codex --oss -m <your-model>

# Or with env vars
export OPENAI_BASE_URL=http://localhost:13439/v1
export OPENAI_API_KEY=alpaca
codex
```

### Copilot CLI
GitHub Copilot command-line interface.

```bash
export COPILOT_PROVIDER_BASE_URL=http://localhost:13439/v1
export COPILOT_PROVIDER_API_KEY=""
export COPILOT_PROVIDER_WIRE_API=responses
export COPILOT_MODEL=<your-model>
copilot
```

### Cline CLI
Autonomous coding agent for interactive terminal sessions.

```bash
# Interactive auth
cline auth
# Select Ollama provider, base URL: http://localhost:13439

# Or with env vars
export OPENAI_BASE_URL=http://localhost:13439/v1
export OPENAI_API_KEY=alpaca
cline --model <your-model>
```

### OpenCode
Open-source AI coding assistant for the terminal.

```bash
curl -fsSL https://opencode.ai/install | bash
export OPENAI_BASE_URL=http://localhost:13439/v1
export OPENAI_API_KEY=alpaca
opencode
```

### Droid
Factory's enterprise software agent.

Add to `~/.factory/config.json`:
```json
{
  "custom_models": [
    {
      "model_display_name": "local-model [Alpaca]",
      "model": "local-model",
      "base_url": "http://localhost:13439/v1/",
      "api_key": "not-needed",
      "provider": "generic-chat-completion-api",
      "max_tokens": 32000
    }
  ]
}
```

### Goose
Block's AI coding agent (desktop + CLI).

**Desktop:** Settings → Configure Provider → Ollama → API Host: `http://localhost:13439`

**CLI:** `goose configure` → select Ollama.

### Pi
Minimal and extensible coding agent.

Add to `~/.pi/agent/models.json`:
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:13439/v1",
      "api": "openai-completions",
      "apiKey": "alpaca",
      "models": [{ "id": "qwen3-coder" }]
    }
  }
}
```

Then set `defaultProvider: "ollama"` in `~/.pi/agent/settings.json`.

### Pool
Poolside's enterprise development agent.

```bash
export POOLSIDE_STANDALONE_BASE_URL=http://localhost:13439/v1
export POOLSIDE_API_KEY=alpaca
pool -m <your-model>
```

---

## Assistants (2)

### OpenClaw
Personal AI assistant bridging messaging services.

```bash
openclaw configure
# Select Ollama provider, base URL: http://localhost:13439

# Connect messaging apps
openclaw configure --section channels
# Supports: WhatsApp, Telegram, Slack, Discord, iMessage
```

### Hermes Agent
Self-improving agent with 70+ skills and messaging gateway.

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# Setup
hermes setup
# → Quick setup → More providers → Custom endpoint
# API base URL: http://127.0.0.1:13439/v1
# Leave API key blank

# Messaging
hermes setup gateway
# Supports: Telegram, Discord, Slack, WhatsApp, Signal, Email
```

---

## IDEs & Editors (6)

### VS Code (Copilot Chat)

1. Install GitHub Copilot Chat extension (free tier works)
2. Open Copilot Chat → gear icon → **Add Models** → **Ollama**
3. Set base URL to `http://localhost:13439/v1`
4. Select your model from the picker (click **Unhide**)
5. Make sure **Local** is selected at the bottom of the panel

**Or use Continue extension:**
```json
{
  "models": [{
    "title": "Alpaca",
    "provider": "ollama",
    "model": "local-model",
    "apiBase": "http://localhost:13439/v1",
    "apiKey": "alpaca"
  }]
}
```

### Cline (VS Code Extension)

1. Install Cline from VS Code Marketplace
2. Open Cline → gear icon → **API Provider** = `Ollama`
3. Set model (e.g. `qwen3`) and context window to at least 32K

### Roo Code (VS Code Extension)

1. Install Roo Code from VS Code Marketplace
2. Open Roo Code → gear icon → **Provider Settings** → **API Provider** = `Ollama`
3. Base URL: `http://localhost:13439`
4. Context window >= 32K

### JetBrains (IntelliJ, PyCharm, WebStorm)

1. Requires **JetBrains AI Subscription**
2. Click chat icon in right sidebar → **Set up Local Models**
3. **Third Party AI Providers** → **Ollama**
4. Host URL: `http://localhost:13439`
5. Select your model

### Xcode

1. Xcode → Settings → Intelligence → **Locally Hosted**
2. Enter port **13439** and click **Add**
3. Select star icon → **My Account** → choose your model
4. Requires Xcode 26.0+ and Apple Intelligence setup

### Zed

1. Click **star icon** (bottom-right) → **Configure**
2. Under **LLM Providers** choose **Ollama**
3. Host URL: `http://localhost:13439`
4. Select your model

---

## Chat & RAG (1)

### Onyx
Self-hostable chat UI with RAG, agents, and app connectors.

1. Deploy Onyx via Docker (`docs.onyx.app` for quickstart)
2. During setup select `Ollama` as the LLM provider
3. API URL: `http://localhost:13439` (or `http://host.docker.internal:13439` in Docker)
4. Select your models

**Features:** Custom agents, web search, deep research, RAG over documents, Google Drive/Slack connectors, MCP support, image generation.

---

## Automation (1)

### n8n

1. In n8n, click dropdown → **Create Credential**
2. Under **Add new credential** select **Ollama**
3. Base URL: `http://localhost:13439` (or `http://host.docker.internal:13439` in Docker)
4. Click **Save** — you should see "Connection tested successfully"
5. Add an **Ollama node** to your workflow and select your model

---

## Notebooks (1)

### marimo

1. Install: `pip install marimo` or `uvx marimo`
2. In marimo: User settings → AI tab → Configure **Ollama**
3. Base URL: `http://localhost:13439/v1`
4. Turn on desired models
5. Enable **inline code completion** in the AI Features tab

```python
import os
os.environ["OPENAI_BASE_URL"] = "http://localhost:13439/v1"
os.environ["OPENAI_API_KEY"] = "alpaca"
```

---

## Sandboxing (1)

### NemoClaw
NVIDIA's security stack for OpenClaw with kernel-level sandboxing.

```bash
export NEMOCLAW_PROVIDER=ollama
export NEMOCLAW_MODEL=nemotron-3-nano:30b
export NEMOCLAW_NON_INTERACTIVE=1
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```

**Requirements:** Docker, Node.js 20+, 8GB+ RAM, Linux/macOS/WSL2.
**Note:** Experimental Ollama support.

---

## Built-in Bots (2)

### Discord Bot

```bash
cd bots/discord-bot
export DISCORD_BOT_TOKEN=your-bot-token
export ALPACA_API_URL=http://localhost:13439/v1/chat/completions
npm install && npm start
```

### Slack Bot

```bash
cd bots/slack-bot
export SLACK_BOT_TOKEN=xoxb-your-token
export SLACK_APP_TOKEN=xapp-your-token
export ALPACA_API_URL=http://localhost:13439/v1/chat/completions
npm install && npm start
```

---

## One-Click Setup from Desktop

The Alpaca desktop app includes an **Integrations** panel that can:

1. **Generate `.env` files** for any supported tool
2. **Show launch commands** with correct environment variables
3. **Copy environment variables** to clipboard
4. **Provide per-tool instructions**

Open the app → **Integrations** tab → select a tool → click **Configure**.

---

## Full Integration Matrix

| Tool | Category | Provider | Large Ctx | Setup |
|------|----------|----------|-----------|-------|
| Claude Code | Coding Agent | Anthropic | Yes (64k) | Env vars |
| Codex App | Coding Agent | OpenAI | Yes (64k) | App settings |
| Codex CLI | Coding Agent | OpenAI | Yes (64k) | --oss flag / profile |
| Copilot CLI | Coding Agent | OpenAI | Yes (64k) | Env vars |
| Cline CLI | Coding Agent | OpenAI | Yes (32k) | Auth wizard |
| OpenCode | Coding Agent | OpenAI | Yes (64k) | Config file |
| Droid | Coding Agent | OpenAI | Yes (64k) | ~/.factory/config.json |
| Goose | Coding Agent | OpenAI | No | Provider settings |
| Pi | Coding Agent | OpenAI | No | ~/.pi/models.json |
| Pool | Coding Agent | OpenAI | Yes (64k) | Env vars |
| OpenClaw | Assistant | OpenAI | Yes (64k) | Configure wizard |
| Hermes Agent | Assistant | OpenAI | Yes (64k) | Setup wizard |
| VS Code | IDE | OpenAI | No | Copilot Chat settings |
| Cline | IDE | OpenAI | Yes (32k) | Extension settings |
| Roo Code | IDE | OpenAI | Yes (32k) | Extension settings |
| JetBrains | IDE | OpenAI | No | AI Subscription → Ollama |
| Xcode | IDE | OpenAI | No | Intelligence settings |
| Zed | IDE | OpenAI | No | LLM Providers → Ollama |
| Onyx | Chat & RAG | OpenAI | No | Docker deployment |
| n8n | Automation | OpenAI | No | Credential → Ollama |
| marimo | Notebook | OpenAI | No | AI settings |
| NemoClaw | Sandboxing | OpenAI | Yes (64k) | Install script |
| Discord Bot | Built-in Bot | OpenAI | No | bots/discord-bot/ |
| Slack Bot | Built-in Bot | OpenAI | No | bots/slack-bot/ |
