# Anthropic API

Configure and use Anthropic's Claude models.

## Overview

Anthropic provides Claude, a powerful family of AI models with strong reasoning capabilities.

## Configuration

```json
{
  "providers": {
    "anthropic": {
      "enabled": true,
      "apiKey": "sk-ant-...",
      "model": "claude-3-sonnet-20240229",
      "maxTokens": 4096,
      "temperature": 0.7
    }
  }
}
```

## Available Models

| Model | Context | Best For |
|-------|---------|----------|
| claude-3-opus | 200K | Complex reasoning, coding |
| claude-3-sonnet | 200K | Balanced performance |
| claude-3-haiku | 200K | Fast responses |
| claude-2.1 | 200K | Long documents |

## API Key Setup

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key
3. Add to Alpaca Settings > API Providers > Anthropic

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'claude-3-sonnet-20240229',
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
  max_tokens: 4096
});
```

## Pricing

See [Anthropic Pricing](https://www.anthropic.com/pricing) for current rates.
