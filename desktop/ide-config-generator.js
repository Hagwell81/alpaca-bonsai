/**
 * IDE Config Generator
 *
 * Generates configuration files for popular IDEs to connect to the local
 * alpaca API (Ollama-compatible endpoint).
 *
 * Supported IDEs:
 * - VS Code (via Continue extension or GitHub Copilot Chat)
 * - Cursor (built-in AI settings)
 * - JetBrains (via Ollama plugin or third-party AI providers)
 */

const path = require('path');
const fs = require('fs');

const API_BASE_URL = 'http://localhost:13439'; // API Gateway default port
const OLLAMA_COMPAT_URL = 'http://localhost:13439/v1';

class IdeConfigGenerator {
  constructor({ app, logger = console } = {}) {
    this.app = app;
    this.logger = logger;
  }

  // -------------------------------------------------------------------------
  // VS Code - Continue extension config
  // -------------------------------------------------------------------------
  generateVsCodeContinueConfig(modelName = 'local-model') {
    return {
      models: [
        {
          title: 'alpaca Local',
          provider: 'ollama',
          model: modelName,
          apiBase: `${API_BASE_URL}/v1`,
          apiKey: 'ollama'
        }
      ],
      tabAutocompleteModel: {
        title: 'alpaca Autocomplete',
        provider: 'ollama',
        model: modelName,
        apiBase: `${API_BASE_URL}/v1`,
        apiKey: 'ollama'
      },
      customCommands: [
        {
          name: 'doc',
          prompt: 'Write documentation for the selected code'
        }
      ],
      contextProviders: [
        { name: 'diff', params: {} },
        { name: 'open', params: {} },
        { name: 'terminal', params: {} }
      ]
    };
  }

  writeVsCodeContinueConfig(outputDir, modelName) {
    const config = this.generateVsCodeContinueConfig(modelName);
    const configPath = path.join(outputDir, 'config.json');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    this.logger.log('[IdeConfigGenerator] VS Code Continue config written to:', configPath);
    return configPath;
  }

  // -------------------------------------------------------------------------
  // VS Code - GitHub Copilot Chat (Ollama provider)
  // -------------------------------------------------------------------------
  generateVsCodeCopilotConfig() {
    return {
      // Settings to add to VS Code settings.json
      'github.copilot.chat.locale': 'en',
      'github.copilot.chat.languageModel': ' alpaca',
      // The user would need to install an Ollama provider extension
      // This config is for reference/documentation
      ollamaHost: API_BASE_URL,
      ollamaApiKey: 'ollama'
    };
  }

  // -------------------------------------------------------------------------
  // Cursor IDE
  // -------------------------------------------------------------------------
  generateCursorConfig() {
    return {
      // Cursor uses its own config file format
      // This generates the API provider section
      provider: 'openai',
      apiKey: 'ollama',
      apiBaseUrl: `${API_BASE_URL}/v1`,
      model: 'local-model',
      // Cursor-specific fields
      openaiCompat: true,
      engine: ' alpaca (Ollama-compatible)',
      customHeaders: {}
    };
  }

  writeCursorConfig(outputDir) {
    const config = this.generateCursorConfig();
    const configPath = path.join(outputDir, '.cursorrules');
    fs.mkdirSync(outputDir, { recursive: true });
    const lines = [
      '# alpaca Configuration for Cursor',
      '',
      '## API Provider',
      `provider: ${config.provider}`,
      `apiBaseUrl: ${config.apiBaseUrl}`,
      `apiKey: ${config.apiKey}`,
      `model: ${config.model}`,
      '',
      '## Instructions for Cursor',
      '1. Open Cursor Settings → AI',
      '2. Set "OpenAI API Key" to: ollama',
      '3. Set "OpenAI Base URL" to: ' + config.apiBaseUrl,
      '4. Select a model name that matches your loaded model'
    ];
    fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
    this.logger.log('[IdeConfigGenerator] Cursor config written to:', configPath);
    return configPath;
  }

  // -------------------------------------------------------------------------
  // JetBrains (IntelliJ, PyCharm, etc.)
  // -------------------------------------------------------------------------
  generateJetBrainsConfig() {
    return {
      // JetBrains AI Assistant supports third-party providers via OpenAI-compatible API
      provider: 'OpenAI',
      apiKey: 'ollama',
      baseUrl: `${API_BASE_URL}/v1`,
      model: 'local-model',
      // Optional: for CodeGPT plugin or similar
      ollama: {
        host: API_BASE_URL,
        model: 'local-model'
      }
    };
  }

  writeJetBrainsConfig(outputDir) {
    const config = this.generateJetBrainsConfig();
    const configPath = path.join(outputDir, 'jetbrains-ai-config.md');
    fs.mkdirSync(outputDir, { recursive: true });
    const lines = [
      '# alpaca Configuration for JetBrains IDEs',
      '',
      '## Setup Instructions',
      '',
      '### Option 1: JetBrains AI Assistant (Third-Party Provider)',
      '1. Open Settings → AI Assistant',
      '2. Select "Third-party AI Provider"',
      '3. Set Base URL: ' + config.baseUrl,
      '4. Set API Key: ollama',
      '5. Set Model: local-model (or your actual model name)',
      '',
      '### Option 2: CodeGPT Plugin',
      '1. Install CodeGPT plugin from Marketplace',
      '2. Open CodeGPT Settings',
      '3. Select Provider: "Custom (OpenAI-compatible)"',
      '4. Set API URL: ' + config.baseUrl,
      '5. Set API Key: ollama',
      '',
      '### Option 3: Ollama Plugin',
      '1. Install "Ollama" plugin from Marketplace',
      '2. Configure host: ' + API_BASE_URL,
      '3. Select your model from the list'
    ];
    fs.writeFileSync(configPath, lines.join('\n'), 'utf8');
    this.logger.log('[IdeConfigGenerator] JetBrains config written to:', configPath);
    return configPath;
  }

  // -------------------------------------------------------------------------
  // Generic MCP config for any IDE with MCP support
  // -------------------------------------------------------------------------
  generateMcpConfig() {
    return {
      mcpServers: {
        alpaca: {
          command: 'node',
          args: [path.join(__dirname, 'knowledge-base-mcp-launcher.js')],
          env: {},
          disabled: false,
          autoApprove: []
        }
      }
    };
  }

  writeMcpConfig(outputDir) {
    const config = this.generateMcpConfig();
    const configPath = path.join(outputDir, 'mcp-config.json');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    this.logger.log('[IdeConfigGenerator] MCP config written to:', configPath);
    return configPath;
  }

  // -------------------------------------------------------------------------
  // Generate all configs into a bundle
  // -------------------------------------------------------------------------
  generateAllConfigs(outputDir, modelName = 'local-model') {
    fs.mkdirSync(outputDir, { recursive: true });
    const paths = [];
    paths.push(this.writeVsCodeContinueConfig(path.join(outputDir, 'vscode-continue'), modelName));
    paths.push(this.writeCursorConfig(path.join(outputDir, 'cursor')));
    paths.push(this.writeJetBrainsConfig(path.join(outputDir, 'jetbrains')));
    paths.push(this.writeMcpConfig(path.join(outputDir, 'mcp')));
    return paths;
  }

  // -------------------------------------------------------------------------
  // IDE auto-config UI helpers
  // -------------------------------------------------------------------------
  getSupportedIdes() {
    return [
      {
        id: 'vscode-continue',
        name: 'VS Code + Continue',
        description: 'Open-source AI code assistant for VS Code',
        installUrl: 'https://marketplace.visualstudio.com/items?itemName=Continue.continue',
        configPath: '.continue/config.json'
      },
      {
        id: 'vscode-copilot',
        name: 'VS Code + GitHub Copilot Chat',
        description: 'GitHub Copilot with Ollama provider extension',
        installUrl: 'https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat',
        configPath: 'settings.json'
      },
      {
        id: 'cursor',
        name: 'Cursor',
        description: 'AI-first code editor',
        installUrl: 'https://www.cursor.com/',
        configPath: '.cursorrules'
      },
      {
        id: 'jetbrains',
        name: 'JetBrains IDEs',
        description: 'IntelliJ, PyCharm, WebStorm, etc.',
        installUrl: 'https://www.jetbrains.com/',
        configPath: 'Settings → AI Assistant'
      },
      {
        id: 'mcp',
        name: 'Any MCP Client',
        description: 'Claude Desktop, Cline, or any MCP-compatible tool',
        installUrl: 'https://modelcontextprotocol.io/',
        configPath: 'claude_desktop_config.json'
      }
    ];
  }
}

module.exports = { IdeConfigGenerator };
