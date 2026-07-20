# API Providers Overview

Alpaca supports multiple AI providers for maximum flexibility.

## Supported Providers

| Provider | Type | Authentication |
|----------|------|----------------|
| OpenAI | Cloud | API Key |
| Anthropic | Cloud | API Key |
| Google | Cloud | API Key |
| Mistral | Cloud | API Key |
| Open Router | Cloud | API Key |
| Azure Foundry | Cloud | Endpoint + Key |
| Ollama | Local | None |
| LM Studio | Local | None |
| Custom | Any | Configurable |

## Provider Comparison

### Cloud Providers

**Pros**:
- No hardware requirements
- Always available
- Latest models

**Cons**:
- Requires API key
- Usage costs
- Data sent externally

### Local Providers

**Pros**:
- Fully private
- No usage costs
- Works offline

**Cons**:
- Requires powerful hardware
- Slower on CPU
- Model management needed

## Configuration

### Enabling Providers

```json
{
  "providers": {
    "openai": { "enabled": true, "apiKey": "..." },
    "anthropic": { "enabled": false },
    "ollama": { "enabled": true }
  }
}
```

### Fallback Chain

```json
{
  "providerFallback": [
    "openai",
    "anthropic",
    "ollama"
  ]
}
```

## Quick Setup

1. Open Settings (Ctrl+,)
2. Select "API Providers"
3. Enable desired providers
4. Add API keys for cloud providers
5. Test connection

## Provider Priority

The app tries providers in order:
1. Primary provider (user selected)
2. Fallback providers (if primary fails)
3. Local models (always available)
