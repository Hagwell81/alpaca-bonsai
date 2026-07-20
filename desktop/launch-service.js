/**
 * Launch Service
 *
 * Auto-configures third-party tools to use the Alpaca local API.
 * Inspired by Ollama's `ollama launch` command.
 *
 * API endpoints (all on port 13439):
 *   - OpenAI-compatible:   http://localhost:13439/v1
 *   - Anthropic-compatible: http://localhost:13439/v1/messages
 *   - Ollama-compatible:   http://localhost:13439/api
 *
 * The Ollama-compatible shim (/api/tags, /api/chat, /api/generate, /api/show,
 * /api/version, /api/ps, /api/embed) lets any Ollama-native client connect
 * to Alpaca without modification. The Anthropic shim (/v1/messages) lets
 * Claude Code and the Anthropic SDK connect directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const ALPACA_HOST = 'http://localhost:13439';
const ALPACA_OPENAI_URL = ALPACA_HOST + '/v1';
const ALPACA_ANTHROPIC_URL = ALPACA_HOST;
const ALPACA_OLLAMA_URL = ALPACA_HOST;

// ---------------------------------------------------------------------------
// Install detection
// ---------------------------------------------------------------------------
//
// Maps integration IDs to the commands/files used to detect whether the tool
// is installed on the user's system. The `check` field is a shell command
// that exits 0 if the tool is available. The `path` field is an optional
// absolute path to check on Windows (where `where` is used). The `darwin`
// and `linux` fields override `check` for platform-specific detection.
//
// Tools that are GUI apps (Codex App, VS Code, JetBrains, Xcode, Zed) are
// detected via filesystem paths rather than shell commands.
// ---------------------------------------------------------------------------
const INSTALL_DETECTORS = {
  claude: { command: 'claude' },
  'codex-app': { appPath: process.platform === 'darwin' ? '/Applications/Codex.app' : null, command: process.platform === 'win32' ? null : null },
  codex: { command: 'codex' },
  'copilot-cli': { command: 'copilot' },
  'cline-cli': { command: 'cline' },
  opencode: { command: 'opencode' },
  droid: { command: 'factory' },
  goose: { command: 'goose' },
  pi: { command: 'pi' },
  pool: { command: 'pool' },
  openclaw: { command: 'openclaw' },
  hermes: { command: 'hermes' },
  vscode: { command: 'code', appPath: process.platform === 'darwin' ? '/Applications/Visual Studio Code.app' : null },
  cline: { appPath: null, command: 'code' }, // Cline is a VS Code extension
  'roo-code': { appPath: null, command: 'code' }, // Roo Code is a VS Code extension
  jetbrains: { appPath: process.platform === 'darwin' ? '/Applications/IntelliJ IDEA.app' : null, command: process.platform === 'win32' ? 'idea' : null },
  xcode: { appPath: process.platform === 'darwin' ? '/Applications/Xcode.app' : null, command: null },
  zed: { appPath: process.platform === 'darwin' ? '/Applications/Zed.app' : null, command: 'zed' },
  onyx: { command: null, appPath: null }, // Onyx is a Docker deployment, not a CLI
  n8n: { command: 'n8n' },
  marimo: { command: 'marimo' },
  nemoclaw: { command: 'nemoclaw' },
  discord: { command: 'node', extraCheck: () => fs.existsSync(path.join(__dirname, '..', 'bots', 'discord-bot', 'package.json')) },
  slack: { command: 'node', extraCheck: () => fs.existsSync(path.join(__dirname, '..', 'bots', 'slack-bot', 'package.json')) },
};

/**
 * Check if a command is available on PATH.
 * @private
 */
function _commandExists(cmd) {
  if (!cmd) return false;
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore', shell: true });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore', shell: true });
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Check if a macOS .app bundle exists.
 * @private
 */
function _appExists(appPath) {
  if (!appPath) return false;
  return fs.existsSync(appPath);
}

class LaunchService {
  constructor({ app, store, logger = console } = {}) {
    this.app = app;
    this.store = store;
    this.logger = logger;
  }

  getIntegrations() {
    return [
      { id: 'claude', name: 'Claude Code', category: 'Coding Agents', provider: 'anthropic', installUrl: 'https://code.claude.com/docs/en/overview', description: "Anthropic's agentic coding tool", recommendedModels: ['bonsai-27b','qwen3.5','glm-5:cloud','kimi-k2.5:cloud'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'codex-app', name: 'Codex App', category: 'Coding Agents', provider: 'openai', installUrl: 'https://developers.openai.com/codex/quickstart/', description: "OpenAI's desktop coding agent", recommendedModels: ['bonsai-27b','gpt-oss:20b','qwen3-coder'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'codex', name: 'Codex CLI', category: 'Coding Agents', provider: 'openai', installUrl: 'https://github.com/openai/codex', description: "OpenAI's CLI coding assistant", recommendedModels: ['bonsai-27b','gpt-oss:20b','qwen3-coder'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'copilot-cli', name: 'Copilot CLI', category: 'Coding Agents', provider: 'openai', installUrl: 'https://github.com/features/copilot/cli/', description: 'GitHub Copilot for the terminal', recommendedModels: ['bonsai-27b','qwen3.5','glm-5:cloud'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'cline-cli', name: 'Cline CLI', category: 'Coding Agents', provider: 'openai', installUrl: 'https://docs.cline.bot/usage/cli-overview', description: 'Autonomous coding agent for the terminal', recommendedModels: ['bonsai-27b','qwen3.5','qwen3-coder'], requiresLargeCtx: true, minCtxTokens: 32000 },
      { id: 'opencode', name: 'OpenCode', category: 'Coding Agents', provider: 'openai', installUrl: 'https://opencode.ai', description: 'Open-source AI coding assistant', recommendedModels: ['bonsai-27b','qwen3-coder','deepseek-coder'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'droid', name: 'Droid', category: 'Coding Agents', provider: 'openai', installUrl: 'https://factory.ai/', description: "Factory's enterprise software agent", recommendedModels: ['bonsai-27b','qwen3-coder','qwen3-coder:480b-cloud'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'goose', name: 'Goose', category: 'Coding Agents', provider: 'openai', installUrl: 'https://block.github.io/goose/', description: "Block's AI coding agent", recommendedModels: ['bonsai-27b','qwen3.5','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'pi', name: 'Pi', category: 'Coding Agents', provider: 'openai', installUrl: 'https://github.com/earendil-works/pi', description: 'Minimal extensible coding agent', recommendedModels: ['bonsai-27b','qwen3-coder','qwen3.5'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'pool', name: 'Pool', category: 'Coding Agents', provider: 'openai', installUrl: 'https://github.com/poolsideai/pool', description: "Poolside's enterprise development agent", recommendedModels: ['bonsai-27b','kimi-k2.6:cloud','qwen3.5'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'openclaw', name: 'OpenClaw', category: 'Assistants', provider: 'openai', installUrl: 'https://github.com/clawdbot/openclaw', description: 'Personal AI bridging WhatsApp, Telegram, Slack, Discord, iMessage', recommendedModels: ['bonsai-27b','kimi-k2.5:cloud','qwen3.5','gemma4'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'hermes', name: 'Hermes Agent', category: 'Assistants', provider: 'openai', installUrl: 'https://github.com/NousResearch/hermes-agent', description: 'Self-improving agent with 70+ skills and messaging gateway', recommendedModels: ['bonsai-27b','kimi-k2.5:cloud','glm-5.1:cloud','gemma4'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'vscode', name: 'VS Code (Copilot Chat)', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://code.visualstudio.com/', description: 'GitHub Copilot Chat with local model picker', recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'cline', name: 'Cline (VS Code)', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://docs.cline.bot/getting-started/installing-cline', description: 'VS Code extension for autonomous coding', recommendedModels: ['qwen3','qwen3-coder:480b'], requiresLargeCtx: true, minCtxTokens: 32000 },
      { id: 'roo-code', name: 'Roo Code', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline', description: 'VS Code extension for AI-powered coding', recommendedModels: ['qwen3-coder:480b','deepseek-v3.1:671b'], requiresLargeCtx: true, minCtxTokens: 32000 },
      { id: 'jetbrains', name: 'JetBrains IDEs', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://www.jetbrains.com/', description: 'IntelliJ, PyCharm, WebStorm via JetBrains AI', recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'xcode', name: 'Xcode', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://developer.apple.com/xcode/', description: "Apple's IDE via locally hosted AI (macOS)", recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'zed', name: 'Zed', category: 'IDEs & Editors', provider: 'openai', installUrl: 'https://zed.dev/', description: 'High-performance collaborative code editor', recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'onyx', name: 'Onyx', category: 'Chat & RAG', provider: 'openai', installUrl: 'https://docs.onyx.app/', description: 'Self-hostable chat UI with RAG and app connectors', recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 32000 },
      { id: 'n8n', name: 'n8n', category: 'Automation', provider: 'openai', installUrl: 'https://n8n.io/', description: 'Workflow automation with Ollama node', recommendedModels: ['qwen3-coder','qwen3'], requiresLargeCtx: false, minCtxTokens: 16000 },
      { id: 'marimo', name: 'marimo', category: 'Notebooks', provider: 'openai', installUrl: 'https://marimo.io/', description: 'Reactive Python notebook with AI chat and inline completion', recommendedModels: ['qwen3','qwen3-coder'], requiresLargeCtx: false, minCtxTokens: 16000 },
      { id: 'nemoclaw', name: 'NemoClaw', category: 'Sandboxing', provider: 'openai', installUrl: 'https://www.nvidia.com/', description: "NVIDIA's security stack for OpenClaw with sandboxing", recommendedModels: ['nemotron-3-nano:30b','qwen3.5','glm-4.7-flash'], requiresLargeCtx: true, minCtxTokens: 64000 },
      { id: 'discord', name: 'Discord Bot', category: 'Built-in Bots', provider: 'openai', installUrl: 'https://discord.com/developers/applications', description: 'Alpaca Discord bot', recommendedModels: ['bonsai-8b','bonsai-27b'], requiresLargeCtx: false, minCtxTokens: 16000 },
      { id: 'slack', name: 'Slack Bot', category: 'Built-in Bots', provider: 'openai', installUrl: 'https://api.slack.com/apps', description: 'Alpaca Slack bot', recommendedModels: ['bonsai-8b','bonsai-27b'], requiresLargeCtx: false, minCtxTokens: 16000 },
    ];
  }

  _anthropicEnv(model) {
    const env = { ANTHROPIC_BASE_URL: ALPACA_ANTHROPIC_URL, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: 'alpaca' };
    if (model) env.CLAUDE_MODEL = model;
    return env;
  }

  _openaiEnv(model) {
    const env = { OPENAI_BASE_URL: ALPACA_OPENAI_URL, OPENAI_API_KEY: 'alpaca' };
    if (model) env.OPENAI_MODEL = model;
    return env;
  }

  _genericEnv(prefix, model) {
    const env = {}; env[prefix + '_BASE_URL'] = ALPACA_OPENAI_URL; env[prefix + '_API_KEY'] = 'alpaca';
    if (model) env[prefix + '_MODEL'] = model;
    return env;
  }

  launchClaude(model) {
    return { integration: 'claude', env: this._anthropicEnv(model), instructions: '1. Set ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY (empty), and ANTHROPIC_AUTH_TOKEN=alpaca. 2. Run: claude --model <your-model>. Requires 64k+ context window.', manualCommand: 'ANTHROPIC_BASE_URL="' + ALPACA_ANTHROPIC_URL + '" ANTHROPIC_API_KEY="" ANTHROPIC_AUTH_TOKEN="alpaca" claude' + (model ? ' --model ' + model : ''), configTip: 'Claude Code requires a large context window (64k+ tokens). Recommended model: bonsai-27b (Ternary-Bonsai, chat + vision). See config/agents/claude-code.md for details.' };
  }

  launchCodexApp(model) {
    return { integration: 'codex-app', env: this._openaiEnv(model), instructions: 'Open Codex App → Settings → set base URL to ' + ALPACA_OPENAI_URL + ' and API key to alpaca.', manualCommand: null, configTip: 'Codex App is a desktop app for macOS and Windows. Requires 64k+ context.' };
  }

  launchCodex(model) {
    return { integration: 'codex', env: this._openaiEnv(model), instructions: 'Use --oss flag: codex --oss -m <model>. Or create ~/.codex/ollama-launch.config.toml with base_url = "' + ALPACA_OPENAI_URL + '"', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" codex --oss' + (model ? ' -m ' + model : ''), configTip: 'For persistent config, create ~/.codex/ollama-launch.config.toml' };
  }

  launchCopilotCli(model) {
    const env = { COPILOT_PROVIDER_BASE_URL: ALPACA_OPENAI_URL, COPILOT_PROVIDER_API_KEY: '', COPILOT_PROVIDER_WIRE_API: 'responses' };
    if (model) env.COPILOT_MODEL = model;
    return { integration: 'copilot-cli', env, instructions: 'Set COPILOT_PROVIDER_BASE_URL, COPILOT_PROVIDER_API_KEY (empty), COPILOT_PROVIDER_WIRE_API=responses. Then run: copilot', manualCommand: 'COPILOT_PROVIDER_BASE_URL="' + ALPACA_OPENAI_URL + '" COPILOT_PROVIDER_API_KEY="" COPILOT_PROVIDER_WIRE_API="responses"' + (model ? ' COPILOT_MODEL="' + model + '"' : '') + ' copilot', configTip: 'Install: brew install copilot-cli. Requires 64k+ context window.' };
  }

  launchClineCli(model) {
    return { integration: 'cline-cli', env: this._openaiEnv(model), instructions: 'Run "cline auth", select Ollama provider, use ' + ALPACA_HOST + ' as base URL. Or: cline', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" cline' + (model ? ' --model ' + model : ''), configTip: 'Install: npm install -g cline. Check config: cline config' };
  }

  launchOpenCode(model) {
    return { integration: 'opencode', env: { ...this._openaiEnv(model), OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { baseUrl: ALPACA_OPENAI_URL, apiKey: 'alpaca' } }) }, instructions: 'Install: curl -fsSL https://opencode.ai/install | bash. Then run with env vars set.', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" opencode', configTip: 'Requires 64k+ context. Config merges ~/.config/opencode/opencode.json' };
  }

  launchDroid(model) {
    const cfg = JSON.stringify({ custom_models: [{ model_display_name: (model || 'local-model') + ' [alpaca]', model: model || 'local-model', base_url: ALPACA_HOST + '/v1/', api_key: 'not-needed', provider: 'generic-chat-completion-api', max_tokens: 32000 }] }, null, 2);
    return { integration: 'droid', env: {}, instructions: 'Add this block to ~/.factory/config.json: ' + cfg, manualCommand: null, configTip: 'Install: curl -fsSL https://app.factory.ai/cli | sh' };
  }

  launchGoose(model) {
    return { integration: 'goose', env: {}, instructions: 'Goose Desktop: Settings → Configure Provider → Ollama, API Host: ' + ALPACA_HOST + '. Goose CLI: goose configure → Ollama.', manualCommand: null, configTip: 'Goose auto-detects Ollama models. For cloud: API Host = https://ollama.com' };
  }

  launchPi(model) {
    const cfg = JSON.stringify({ providers: { ollama: { baseUrl: ALPACA_HOST + '/v1', api: 'openai-completions', apiKey: 'alpaca', models: [{ id: model || 'qwen3-coder' }] } } }, null, 2);
    return { integration: 'pi', env: this._openaiEnv(model), instructions: 'Add to ~/.pi/agent/models.json: ' + cfg + '. Set defaultProvider to "ollama" in settings.json.', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" pi', configTip: 'Install: npm install -g @earendil-works/pi-coding-agent' };
  }

  launchPool(model) {
    return { integration: 'pool', env: { POOLSIDE_STANDALONE_BASE_URL: ALPACA_HOST + '/v1', POOLSIDE_API_KEY: 'alpaca' }, instructions: 'Set POOLSIDE_STANDALONE_BASE_URL and POOLSIDE_API_KEY, then run: pool -m <model>', manualCommand: 'POOLSIDE_STANDALONE_BASE_URL="' + ALPACA_HOST + '/v1" POOLSIDE_API_KEY="alpaca" pool' + (model ? ' -m ' + model : ''), configTip: 'Install from https://github.com/poolsideai/pool' };
  }

  launchOpenClaw(model) {
    return { integration: 'openclaw', env: this._openaiEnv(model), instructions: 'Run: openclaw configure. Select Ollama provider, base URL: ' + ALPACA_HOST + '. Connect messaging: openclaw configure --section channels.', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" openclaw', configTip: 'Supports WhatsApp, Telegram, Slack, Discord, iMessage. Web search enabled automatically.' };
  }

  launchHermes(model) {
    return { integration: 'hermes', env: {}, instructions: 'Run: hermes setup → Quick setup → More providers → Custom endpoint. URL: ' + ALPACA_OPENAI_URL + ', leave API key blank.', manualCommand: null, configTip: 'Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash. Supports Telegram, Discord, Slack, WhatsApp, Signal, Email.' };
  }

  launchVsCode(model) {
    return { integration: 'vscode', env: this._openaiEnv(model), instructions: '1. Install Copilot Chat. 2. Open Copilot Chat → gear → Add Models → Ollama. 3. Base URL: ' + ALPACA_OPENAI_URL + '. 4. Unhide models.', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" code', configTip: 'VS Code 1.113+ required. Free Copilot tier enables model selection. Select "Local" in panel.' };
  }

  launchCline(model) {
    return { integration: 'cline', env: {}, instructions: 'Open Cline → gear → API Provider = Ollama. Set model and context window >= 32K.', manualCommand: null, configTip: 'VS Code Marketplace. For cloud: check "Use custom base URL" → https://ollama.com' };
  }

  launchRooCode(model) {
    return { integration: 'roo-code', env: {}, instructions: 'Open Roo Code → gear → Provider Settings → API Provider = Ollama. Base URL: ' + ALPACA_HOST + '. Context >= 32K.', manualCommand: null, configTip: 'VS Code Marketplace. Recommended: qwen3-coder:480b or deepseek-v3.1:671b' };
  }

  launchJetBrains(model) {
    return { integration: 'jetbrains', env: {}, instructions: 'Requires JetBrains AI Subscription. Chat icon → Set up Local Models → Third Party AI Providers → Ollama. Host URL: ' + ALPACA_HOST + '.', manualCommand: null, configTip: 'Works in IntelliJ, PyCharm, WebStorm, etc.' };
  }

  launchXcode(model) {
    return { integration: 'xcode', env: {}, instructions: 'Xcode → Settings → Intelligence → Locally Hosted. Port: 13439 → Add. Star icon → My Account → select model. Requires Xcode 26.0+.', manualCommand: null, configTip: 'macOS only. Ensure Apple Intelligence is set up. For cloud: Internet Hosted → https://ollama.com' };
  }

  launchZed(model) {
    return { integration: 'zed', env: {}, instructions: 'Star icon (bottom-right) → Configure → LLM Providers → Ollama. Host URL: ' + ALPACA_HOST + '. Then select model.', manualCommand: null, configTip: 'Install from https://zed.dev/download. For cloud: API URL = https://ollama.com with API key.' };
  }

  launchOnyx(model) {
    return { integration: 'onyx', env: {}, instructions: 'Deploy Onyx via Docker. Setup → Ollama as LLM provider. API URL: ' + ALPACA_HOST + ' (or http://host.docker.internal:13439 in Docker).', manualCommand: null, configTip: 'Features: agents, web search, deep research, RAG, Google Drive/Slack connectors, MCP, image generation.' };
  }

  launchN8n(model) {
    return { integration: 'n8n', env: {}, instructions: 'n8n → Create Credential → Ollama. Base URL: ' + ALPACA_HOST + ' (or http://host.docker.internal:13439 in Docker). Test → save. Add Ollama node.', manualCommand: null, configTip: 'Docker: add extra_hosts: ["host.docker.internal:host-gateway"] to docker-compose.' };
  }

  launchMarimo(model) {
    return { integration: 'marimo', env: this._openaiEnv(model), instructions: 'marimo → User settings → AI tab → Configure Ollama. Base URL: ' + ALPACA_HOST + '/v1. Enable inline completion in AI Features tab.', manualCommand: 'OPENAI_BASE_URL="' + ALPACA_OPENAI_URL + '" OPENAI_API_KEY="alpaca" marimo edit', configTip: 'Install: pip install marimo or uvx marimo. Also supports cloud models.' };
  }

  launchNemoClaw(model) {
    return { integration: 'nemoclaw', env: { NEMOCLAW_PROVIDER: 'ollama', NEMOCLAW_MODEL: model || 'nemotron-3-nano:30b', NEMOCLAW_NON_INTERACTIVE: '1' }, instructions: 'Install: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash. Requires Docker, Node.js 20+, 8GB+ RAM.', manualCommand: 'NEMOCLAW_PROVIDER="ollama" NEMOCLAW_MODEL="' + (model || 'nemotron-3-nano:30b') + '" NEMOCLAW_NON_INTERACTIVE=1 bash <(curl -fsSL https://www.nvidia.com/nemoclaw.sh)', configTip: 'Experimental. Requires Linux/macOS or WSL2. Ollama must be reachable from sandbox (OLLAMA_HOST=0.0.0.0).' };
  }

  launchDiscord(model) {
    return { integration: 'discord', env: { DISCORD_BOT_TOKEN: '<your-bot-token>', ALPACA_API_URL: ALPACA_HOST + '/v1/chat/completions', ALPACA_MODEL: model || 'local-model' }, instructions: '1. Create bot at discord.com/developers. 2. cd bots/discord-bot && npm install. 3. Set env vars. 4. npm start', manualCommand: 'cd bots/discord-bot && DISCORD_BOT_TOKEN=xxx ALPACA_API_URL="' + ALPACA_HOST + '/v1/chat/completions" ALPACA_MODEL="' + (model || 'local-model') + '" npm start', configTip: 'Bot responds to @mentions and DMs. Enable Message Content Intent.' };
  }

  launchSlack(model) {
    return { integration: 'slack', env: { SLACK_BOT_TOKEN: '<xoxb-your-token>', SLACK_APP_TOKEN: '<xapp-your-token>', ALPACA_API_URL: ALPACA_HOST + '/v1/chat/completions', ALPACA_MODEL: model || 'local-model' }, instructions: '1. Create app at api.slack.com/apps. 2. Enable Socket Mode. 3. cd bots/slack-bot && npm install. 4. Set env vars. 5. npm start', manualCommand: 'cd bots/slack-bot && SLACK_BOT_TOKEN=xxx SLACK_APP_TOKEN=xxx ALPACA_API_URL="' + ALPACA_HOST + '/v1/chat/completions" ALPACA_MODEL="' + (model || 'local-model') + '" npm start', configTip: 'Scopes: app_mentions:read, chat:write, im:history, channels:history' };
  }

  launch(integrationId, model) {
    switch (integrationId) {
      case 'claude': return this.launchClaude(model);
      case 'codex-app': return this.launchCodexApp(model);
      case 'codex': return this.launchCodex(model);
      case 'copilot-cli': return this.launchCopilotCli(model);
      case 'cline-cli': return this.launchClineCli(model);
      case 'opencode': return this.launchOpenCode(model);
      case 'droid': return this.launchDroid(model);
      case 'goose': return this.launchGoose(model);
      case 'pi': return this.launchPi(model);
      case 'pool': return this.launchPool(model);
      case 'openclaw': return this.launchOpenClaw(model);
      case 'hermes': return this.launchHermes(model);
      case 'vscode': return this.launchVsCode(model);
      case 'cline': return this.launchCline(model);
      case 'roo-code': return this.launchRooCode(model);
      case 'jetbrains': return this.launchJetBrains(model);
      case 'xcode': return this.launchXcode(model);
      case 'zed': return this.launchZed(model);
      case 'onyx': return this.launchOnyx(model);
      case 'n8n': return this.launchN8n(model);
      case 'marimo': return this.launchMarimo(model);
      case 'nemoclaw': return this.launchNemoClaw(model);
      case 'discord': return this.launchDiscord(model);
      case 'slack': return this.launchSlack(model);
      default: throw new Error('Unknown integration: ' + integrationId);
    }
  }

  generateEnvFile(integrationId, model) {
    const result = this.launch(integrationId, model);
    const env = result.env || {};
    const lines = [
      '# alpaca Integration Environment Variables',
      '# Integration: ' + integrationId,
      '# Generated: ' + new Date().toISOString(),
      '# API Base: ' + ALPACA_HOST,
      '',
      ...Object.entries(env).map(([k, v]) => k + '=' + v),
      '',
      '# Setup instructions:',
      '# ' + (result.instructions || '').replace(/\n/g, '\n# '),
    ];
    return lines.join('\n');
  }

  writeEnvFile(integrationId, model, outputDir) {
    const content = this.generateEnvFile(integrationId, model);
    const fileName = '.alpaca-' + integrationId + '.env';
    const filePath = path.join(outputDir, fileName);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Check whether a given integration's tool is installed on the user's system.
   *
   * @param {string} integrationId - The integration ID (e.g. 'claude', 'codex')
   * @returns {{ installed: boolean, method: string|null, detail: string }}
   *   `method` is 'command' | 'app' | 'extra' | null describing how the
   *   detection was performed. `detail` is a human-readable explanation.
   */
  checkIfInstalled(integrationId) {
    const detector = INSTALL_DETECTORS[integrationId];
    if (!detector) {
      return { installed: false, method: null, detail: 'No install detector configured for this integration.' };
    }

    // 1. macOS .app bundle check (highest priority for GUI apps)
    if (detector.appPath) {
      if (_appExists(detector.appPath)) {
        return { installed: true, method: 'app', detail: 'Found at ' + detector.appPath };
      }
      // On macOS, if an appPath is configured but missing, fall through to
      // command check (some apps also install a CLI helper).
      if (process.platform === 'darwin') {
        // continue to command check
      } else {
        // On non-macOS, an appPath check that fails means not installed
        return { installed: false, method: 'app', detail: 'Application not found at ' + detector.appPath };
      }
    }

    // 2. Extra check (e.g. bot package.json presence)
    if (detector.extraCheck) {
      try {
        if (detector.extraCheck()) {
          // For bots, the command (node) must also exist
          if (!detector.command || _commandExists(detector.command)) {
            return { installed: true, method: 'extra', detail: 'Required files found and ' + (detector.command || 'node') + ' is available' };
          }
          return { installed: false, method: 'extra', detail: 'Required files found but ' + (detector.command || 'node') + ' is not on PATH' };
        }
      } catch (_) { /* fall through */ }
    }

    // 3. Command on PATH check
    if (detector.command) {
      if (_commandExists(detector.command)) {
        return { installed: true, method: 'command', detail: 'Command "' + detector.command + '" found on PATH' };
      }
      return { installed: false, method: 'command', detail: 'Command "' + detector.command + '" not found on PATH' };
    }

    // 4. No detector usable
    return {
      installed: false,
      method: null,
      detail: 'This integration requires manual setup. See the integration\'s documentation.',
    };
  }

  /**
   * Check all integrations and return a map of integrationId -> installed status.
   * @returns {Record<string, { installed: boolean, method: string|null, detail: string }>}
   */
  checkAllInstalled() {
    const result = {};
    for (const integration of this.getIntegrations()) {
      try {
        result[integration.id] = this.checkIfInstalled(integration.id);
      } catch (err) {
        result[integration.id] = { installed: false, method: null, detail: err.message };
      }
    }
    return result;
  }

  /**
   * Launch an integration's tool in a new terminal window with the Alpaca
   * environment variables pre-set. The tool is launched with its recommended
   * command (from the `manualCommand` field) so it picks up the Alpaca API
   * endpoint automatically.
   *
   * @param {string} integrationId - The integration ID
   * @param {string} [model] - Optional model name to pass
   * @returns {{ success: boolean, error?: string, manualCommand?: string, env?: Object }}
   */
  launchIntegration(integrationId, model) {
    const status = this.checkIfInstalled(integrationId);
    if (!status.installed) {
      return {
        success: false,
        error: 'Integration "' + integrationId + '" is not installed. ' + status.detail,
        installDetail: status.detail,
      };
    }

    // Get the launch config (env vars + manual command)
    const result = this.launch(integrationId, model);
    const env = result.env || {};
    const manualCommand = result.manualCommand;

    // Some integrations don't have a launchable command (GUI apps that need
    // manual setup, Docker deployments, etc.). For those, return the config
    // so the UI can show instructions.
    if (!manualCommand) {
      return {
        success: true,
        launched: false,
        message: 'Tool is installed but must be launched manually. Configuration has been prepared.',
        env,
        instructions: result.instructions,
        configTip: result.configTip,
      };
    }

    // Build the full command with env vars prefixed.
    // On Windows, env vars are set inline with `set VAR=value &&`.
    // On Unix, env vars are prefixed to the command.
    let fullCommand;
    let useShell = true;

    // Filter out placeholder values (e.g. '<your-bot-token>') — the user must
    // fill those in manually. We still launch with the other vars set.
    const realEnv = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string' && v.startsWith('<') && v.endsWith('>')) {
        // Placeholder — skip; user must set manually
        continue;
      }
      realEnv[k] = v;
    }

    if (process.platform === 'win32') {
      // Windows: use `set VAR=value &&` prefixing, then run the manual command
      const envPrefix = Object.entries(realEnv)
        .map(([k, v]) => `set "${k}=${v}"`)
        .join(' && ');
      // The manualCommand may already include env vars inline; if so, we
      // still set them via `set` first (the inline ones in the command will
      // override for that command's scope). To avoid duplication issues,
      // strip any inline env var assignments from manualCommand on Windows
      // since we're setting them via `set` already.
      let cmd = manualCommand;
      // Strip leading VAR=value patterns from the command (Windows-style)
      cmd = cmd.replace(/^[A-Z_]+="[^"]*"\s+/g, '').trim();
      fullCommand = envPrefix ? `${envPrefix} && ${cmd}` : cmd;
    } else {
      // Unix: prefix env vars to the command
      const envPrefix = Object.entries(realEnv)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      fullCommand = envPrefix ? `${envPrefix} ${manualCommand}` : manualCommand;
    }

    try {
      if (process.platform === 'win32') {
        // Windows: open a new cmd window with `start`
        spawn('cmd.exe', ['/c', 'start', '"Alpaca — ' + integrationId + '"', 'cmd.exe', '/k', fullCommand], {
          detached: true,
          shell: true,
          stdio: 'ignore',
        }).unref();
      } else if (process.platform === 'darwin') {
        // macOS: use Terminal.app via osascript
        const { exec } = require('child_process');
        const escapedCmd = fullCommand.replace(/"/g, '\\"');
        const script = `tell application "Terminal" to do script "${escapedCmd}"`;
        exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { detached: true }).unref();
      } else {
        // Linux: try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xterm', 'xfce4-terminal'];
        const escapedCmd = fullCommand.replace(/'/g, "'\\''");
        let launched = false;
        for (const term of terminals) {
          try {
            spawn(term, ['-e', 'bash', '-c', escapedCmd], {
              detached: true,
              stdio: 'ignore',
            }).unref();
            launched = true;
            break;
          } catch (_) { /* try next */ }
        }
        if (!launched) {
          return { success: false, error: 'No supported terminal emulator found. Launch command: ' + fullCommand, manualCommand: fullCommand, env: realEnv };
        }
      }

      return {
        success: true,
        launched: true,
        message: 'Launched ' + integrationId + ' in a new terminal with Alpaca configuration.',
        manualCommand: fullCommand,
        env: realEnv,
      };
    } catch (err) {
      return {
        success: false,
        error: 'Failed to launch: ' + err.message,
        manualCommand: fullCommand,
        env: realEnv,
      };
    }
  }
}

module.exports = {
  LaunchService,
  ALPACA_HOST,
  ALPACA_OPENAI_URL,
  ALPACA_ANTHROPIC_URL,
  ALPACA_OLLAMA_URL,
  INSTALL_DETECTORS,
};
