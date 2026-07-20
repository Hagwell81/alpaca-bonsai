/**
 * Knowledge Base MCP Launcher
 *
 * Standalone entry point for spawning the KB MCP server.
 * Used by external MCP clients (IDEs, agents) to connect.
 */

const path = require('path');
const { KnowledgeBase } = require('./knowledge-base');
const { KnowledgeBaseMcpServer } = require('./knowledge-base-mcp');

const appDataDir = process.env.KB_APP_DATA || require('os').homedir();
const mockApp = {
  getPath: (type) => {
    if (type === 'userData') return path.join(appDataDir, '.alpaca');
    return appDataDir;
  }
};

const kb = new KnowledgeBase({ app: mockApp, logger: console, embeddingPort: 13434 });
kb.init().then(() => {
  const server = new KnowledgeBaseMcpServer({ knowledgeBase: kb, logger: console });
  server.start();
}).catch((err) => {
  console.error('Failed to start KB MCP server:', err.message);
  process.exit(1);
});
