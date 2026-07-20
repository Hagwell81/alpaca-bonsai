/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a set of docs in the sidebar
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

module.exports = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/index',
        'getting-started/installer-setup',
        'getting-started/installation',
        'getting-started/quickstart',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      items: [
        'user-guide/features-overview',
        'features',
        'user-guide/chat-interface',
        'user-guide/conversation-features',
        'user-guide/model-management',
        'user-guide/settings',
      ],
    },
    {
      type: 'category',
      label: 'API Management',
      items: [
        'api-management/overview',
        'api-management/providers',
        'api-management/openai',
        'api-management/google',
        'api-management/anthropic',
        'api-management/mistral',
        'api-management/open-router',
        'api-management/ollama',
        'api-management/lm-studio',
        'api-management/azure-foundry',
        'api-management/custom-endpoints',
        'api-management/key-management',
      ],
    },
    {
      type: 'category',
      label: 'Agentic Services',
      items: [
        'agentic/overview',
        'agentic/multi-agent-architecture',
        'agentic/creating-agents',
        'agentic/creating-tools',
        'agentic/creating-skills',
        'agentic/subagent-delegation',
        'agentic/spec-driven-development',
      ],
    },
    {
      type: 'category',
      label: 'Knowledge Base & RAG',
      items: [
        'rag/adding-documents',
        'rag/querying',
        'rag/vector-stores',
      ],
    },
    {
      type: 'category',
      label: 'Workspace & Collaboration',
      items: [
        'workspace/project-structure',
        'workspace/context-isolation',
        'workspace/file-operations',
        'workspace/memory-system',
      ],
    },
    {
      type: 'category',
      label: 'Desktop Application',
      items: [
        'desktop/app-menu',
        'desktop/documentation-viewer',
        'desktop/keyboard-shortcuts',
        'desktop/system-tray',
        'desktop/updater',
        'desktop/migration-guide',
        'desktop/pre-dev-enhancements',
        'desktop/api-reference',
        'desktop/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'IDE Integration',
      items: [
        'ide/cursor-integration',
        'ide/keyboard-shortcuts',
        'ide/project-awareness',
        'ide/vscode-integration',
      ],
    },
    {
      type: 'category',
      label: 'Development',
      items: [
        'development/architecture',
        'development/build-system',
        'development/contributing',
        'development/debugging',
        'development/testing',
        'development/building-systems',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/rest-api',
        'api/tool-calling',
        'api/ipc-channels',
        'api/websocket',
        'api/authentication',
        'api/rate-limiting',
        {
          type: 'link',
          label: 'API Explorer (Swagger UI)',
          href: '/api-explorer',
        },
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'advanced/api-integration',
        'advanced/performance-tuning',
        'advanced/security',
        'advanced/deployment',
        'advanced/troubleshooting',
        'advanced/faq',
      ],
    },
    {
      type: 'doc',
      label: 'Integrations',
      id: 'integrations',
    },
    {
      type: 'category',
      label: 'Roadmap',
      items: [
        'roadmap',
      ],
    },
  ],
};
