# OpenAI API

Use OpenAI's GPT models for powerful AI capabilities.

## Overview

OpenAI provides industry-leading language models including GPT-4 and GPT-3.5.

## Configuration

```json
{
  "providers": {
    "openai": {
      "enabled": true,
      "apiKey": "sk-...",
      "model": "gpt-4",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

## Available Models

| Model | Context | Best For |
|-------|---------|----------|
| gpt-4 | 8K/32K | Complex tasks |
| gpt-4-turbo | 128K | Long documents |
| gpt-3.5-turbo | 16K | Fast responses |

## API Key Setup

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create API key
3. Add to Alpaca Settings > API Providers > OpenAI

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Pricing

See [OpenAI Pricing](https://openai.com/pricing) for current rates.
