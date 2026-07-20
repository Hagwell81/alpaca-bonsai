# OpenRouter

Access multiple models through a unified API.

## Overview

OpenRouter provides access to hundreds of models from various providers through a single API.

## Configuration

```json
{
  "providers": {
    "open-router": {
      "enabled": true,
      "apiKey": "sk-or-...",
      "model": "anthropic/claude-3-sonnet"
    }
  }
}
```

## Available Models

Access models from:
- Anthropic (Claude)
- OpenAI (GPT-4, GPT-3.5)
- Google (Gemini)
- Meta (Llama)
- Mistral
- And 100+ more

## API Key Setup

1. Go to [OpenRouter](https://openrouter.ai/)
2. Create account and API key
3. Add to Alpaca Settings

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'anthropic/claude-3-sonnet',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Model Routing

```typescript
const response = await client.chat.completions.create({
  model: 'openai/gpt-4',
  messages: [...],
  extra_body: {
    provider: {
      order: ["OpenAI", "Anthropic"]
    }
  }
});
```

## Pricing

Pay-per-use with transparent pricing. See [OpenRouter pricing](https://openrouter.ai/docs#pricing).
