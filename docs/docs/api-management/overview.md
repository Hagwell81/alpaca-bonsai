---
sidebar_position: 1
title: API Management Overview
description: Manage multiple AI provider APIs
---

# API Management Overview

The API Management Service provides a unified interface for managing credentials and models from multiple AI providers. This allows you to seamlessly switch between different providers while maintaining a consistent chat experience.

## Supported Providers

### Cloud Providers
- **OpenAI** - GPT-4, GPT-3.5, and other models
- **Google** - Gemini, PaLM, and other models
- **Anthropic** - Claude 3, Claude 2, and other models
- **Mistral** - Mistral Large, Medium, Small
- **Open Router** - Access to 100+ models from various providers

### Local & Self-Hosted
- **Ollama** - Local model management and serving
- **LM Studio** - Local model inference
- **Azure Foundry (Local)** - Local Azure deployment

### Custom
- **Custom OpenAI-Compatible Endpoints** - Any endpoint following OpenAI API spec

## Architecture

```
┌─────────────────────────────────────────────────┐
│         Chat Interface / IDE / Agents           │
└────────────────────┬────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │  API Management       │
         │  Service              │
         ├───────────────────────┤
         │ • Provider Registry   │
         │ • Credential Manager  │
         │ • Model Selector      │
         │ • Request Router      │
         └───────────┬───────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼─────┐  ┌────▼─────┐  ┌───▼─────┐
   │  Cloud   │  │  Local   │  │ Custom  │
   │ Providers│  │ Providers│  │Endpoints│
   └──────────┘  └──────────┘  └─────────┘
```

## Key Features

### Multi-Provider Support
- Add credentials for multiple providers
- Switch providers without restarting
- Use different providers for different tasks

### Secure Credential Management
- Encrypted API key storage
- No keys sent to external services
- Local-only credential management

### Model Discovery
- Automatic model listing from providers
- Model metadata (context window, pricing, etc.)
- Model availability checking

### Request Routing
- Automatic provider selection
- Fallback to alternative providers
- Load balancing across providers

### Usage Tracking
- Monitor API usage and costs
- Track request history
- Generate usage reports

## Getting Started

### 1. Add Your First Provider

1. Open **Settings** > **API Providers**
2. Click **Add Provider**
3. Select your provider (e.g., OpenAI)
4. Enter your API key
5. Click **Save**

### 2. Select a Model

1. In the chat interface, click **Model Selector**
2. Choose your provider
3. Select a model from the list
4. Start chatting!

### 3. Configure Defaults

1. Go to **Settings** > **API Providers**
2. Set default provider and model
3. Configure fallback providers
4. Save preferences

## Provider Configuration

Each provider requires specific configuration:

- **OpenAI**: API key from https://platform.openai.com/api-keys
- **Google**: API key from Google Cloud Console
- **Anthropic**: API key from https://console.anthropic.com
- **Mistral**: API key from https://console.mistral.ai
- **Open Router**: API key from https://openrouter.ai
- **Ollama**: Local endpoint (default: http://localhost:11434)
- **LM Studio**: Local endpoint (default: http://localhost:1234)
- **Azure Foundry**: Local endpoint and configuration

## Security Considerations

### API Key Storage
- Keys are encrypted using system keyring
- Never logged or transmitted externally
- Can be revoked anytime from provider dashboard

### Best Practices
1. Use provider-specific API keys (not master keys)
2. Set usage limits on provider dashboards
3. Rotate keys regularly
4. Monitor usage for unusual activity
5. Use separate keys for development and production

## Advanced Features

### Custom Endpoints
Connect to any OpenAI-compatible endpoint:

```json
{
  "name": "My Custom LLM",
  "type": "custom",
  "baseUrl": "https://my-llm-server.com/v1",
  "apiKey": "your-api-key",
  "models": ["custom-model-1", "custom-model-2"]
}
```

### Provider Fallback
Configure automatic fallback when primary provider fails:

```json
{
  "primaryProvider": "openai",
  "fallbackProviders": ["anthropic", "mistral"],
  "retryPolicy": {
    "maxRetries": 3,
    "backoffMs": 1000
  }
}
```

### Usage Limits
Set spending limits per provider:

```json
{
  "provider": "openai",
  "limits": {
    "monthlyBudget": 100,
    "requestsPerMinute": 60,
    "tokensPerMinute": 90000
  }
}
```

## Detailed Provider Guides

- **[OpenAI](./openai.md)** - GPT-4 and GPT-3.5 setup
- **[Google](./google.md)** - Gemini setup
- **[Anthropic](./anthropic.md)** - Claude setup
- **[Mistral](./mistral.md)** - Mistral models setup
- **[Open Router](./open-router.md)** - Multi-provider access
- **[Ollama](./ollama.md)** - Local model serving
- **[LM Studio](./lm-studio.md)** - Local inference
- **[Azure Foundry](./azure-foundry.md)** - Azure local deployment
- **[Custom Endpoints](./custom-endpoints.md)** - Custom OpenAI-compatible servers

## API Reference

### Get Available Providers

```typescript
const providers = await window.llamaAPI.getAvailableProviders();
```

### Get Provider Models

```typescript
const models = await window.llamaAPI.getProviderModels('openai');
```

### Add Provider Credential

```typescript
await window.llamaAPI.addProviderCredential({
  provider: 'openai',
  apiKey: 'sk-...',
  name: 'My OpenAI Account'
});
```

### Set Active Provider

```typescript
await window.llamaAPI.setActiveProvider('openai');
```

### Get Usage Statistics

```typescript
const usage = await window.llamaAPI.getProviderUsage('openai');
```

## Troubleshooting

### Invalid API Key
- Verify key is correct from provider dashboard
- Check for extra spaces or characters
- Ensure key hasn't expired

### Model Not Found
- Refresh model list
- Verify provider account has access
- Check provider status page

### Connection Failed
- Verify internet connection
- Check provider status page
- Try alternative provider

### High Costs
- Review usage statistics
- Set spending limits
- Use smaller models
- Implement request caching

## Next Steps

- **[Key Management](./key-management.md)** - Secure credential handling
- **[Development](../development/building-systems.md)** - Build systems with the API
- **[Agentic Services](../agentic/overview.md)** - Use providers in agents
