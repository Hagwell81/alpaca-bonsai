/**
 * Knowledge Base MCP Server
 *
 * Exposes Knowledge Base capabilities as an MCP (Model Context Protocol) server
 * so that external applications (IDEs, agents, etc.) can query the KB.
 *
 * Uses stdio transport for compatibility with MCP clients.
 */

const readline = require('readline');

class KnowledgeBaseMcpServer {
  constructor({ knowledgeBase, logger = console } = {}) {
    this.kb = knowledgeBase;
    this.logger = logger;
    this.initialized = false;
  }

  start() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this._sendError(null, -32700, 'Parse error');
        return;
      }
      this._handleMessage(msg);
    });

    this.logger.log('[KB-MCP] Server started on stdio');
  }

  _handleMessage(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      this.initialized = true;
      this._sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'alpaca-kb', version: '2.0.1' }
      });
      return;
    }
    if (method === 'initialized') {
      return;
    }
    if (!this.initialized) {
      this._sendError(id, -32002, 'Server not initialized');
      return;
    }

    switch (method) {
      case 'tools/list':
        this._sendResponse(id, { tools: this._getTools() });
        break;
      case 'tools/call':
        this._handleToolCall(id, params);
        break;
      case 'resources/list':
        this._sendResponse(id, { resources: [] });
        break;
      default:
        this._sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  _getTools() {
    return [
      {
        name: 'kb_search',
        description: 'Search the knowledge base for relevant context',
        inputSchema: {
          type: 'object',
          properties: {
            collection_id: { type: 'string', description: 'Collection ID to search' },
            query: { type: 'string', description: 'Search query' },
            top_k: { type: 'number', description: 'Number of results (default 5)' }
          },
          required: ['collection_id', 'query']
        }
      },
      {
        name: 'kb_list_collections',
        description: 'List all knowledge base collections',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'kb_get_documents',
        description: 'List documents in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection_id: { type: 'string', description: 'Collection ID' }
          },
          required: ['collection_id']
        }
      },
      {
        name: 'kb_build_rag_context',
        description: 'Build RAG context string for a query',
        inputSchema: {
          type: 'object',
          properties: {
            collection_id: { type: 'string', description: 'Collection ID' },
            query: { type: 'string', description: 'User query' },
            top_k: { type: 'number', description: 'Number of chunks (default 5)' }
          },
          required: ['collection_id', 'query']
        }
      }
    ];
  }

  async _handleToolCall(id, params) {
    const { name, arguments: args } = params || {};
    try {
      switch (name) {
        case 'kb_search': {
          const results = await this.kb.search(args.collection_id, args.query, args.top_k || 5);
          this._sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] });
          break;
        }
        case 'kb_list_collections': {
          const collections = await this.kb.getCollections();
          this._sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(collections, null, 2) }] });
          break;
        }
        case 'kb_get_documents': {
          const docs = await this.kb.getDocuments(args.collection_id);
          this._sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }] });
          break;
        }
        case 'kb_build_rag_context': {
          const context = await this.kb.buildRagContext(args.collection_id, args.query, args.top_k || 5);
          this._sendResponse(id, { content: [{ type: 'text', text: context }] });
          break;
        }
        default:
          this._sendError(id, -32602, `Unknown tool: ${name}`);
      }
    } catch (err) {
      this.logger.error('[KB-MCP] Tool error:', err.message);
      this._sendError(id, -32603, err.message);
    }
  }

  _sendResponse(id, result) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(msg + '\n');
  }

  _sendError(id, code, message) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(msg + '\n');
  }
}

module.exports = { KnowledgeBaseMcpServer };
