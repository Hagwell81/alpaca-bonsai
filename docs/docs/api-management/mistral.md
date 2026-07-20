# Mistral AI

Use Mistral's powerful open models and API.

## Overview

Mistral AI provides both open-weight models and a managed API service.

## Configuration

```json
{
  "providers": {
    "mistral": {
      "enabled": true,
      "apiKey": "your-mistral-key",
      "model": "mistral-medium"
    }
  }
}
```

## Available Models

| Model | Type | Context |
|-------|------|---------|
| mistral-large | Proprietary | 32K |
| mistral-medium | Proprietary | 32K |
| mistral-small | Proprietary | 32K |
| mistral-7b | Open | 8K |
| mixtral-8x7b | Open | 32K |

## API Key Setup

1. Go to [Mistral Console](https://console.mistral.ai/)
2. Create an API key
3. Add to Alpaca Settings

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'mistral-medium',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Local Deployment

Use Mistral models locally with llama.cpp:

1. Download GGUF from [HuggingFace](https://huggingface.co/mistralai)
2. Load in Alpaca
3. Use without API keys
