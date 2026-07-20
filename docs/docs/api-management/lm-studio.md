# LM Studio

Connect to LM Studio's local server for easy model management.

## Overview

LM Studio provides a user-friendly interface for running local LLMs with an OpenAI-compatible API.

## Configuration

```json
{
  "providers": {
    "lm-studio": {
      "enabled": true,
      "baseUrl": "http://localhost:1234/v1",
      "apiKey": "not-needed"
    }
  }
}
```

## Setup

1. Download [LM Studio](https://lmstudio.ai/)
2. Load a model
3. Start the local server
4. Configure Alpaca to connect

## Features

- Easy model downloads
- GPU acceleration
- Model switching
- Chat interface
- API server mode

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'local-model',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Troubleshooting

### Connection Refused

1. Ensure LM Studio server is running
2. Check port (default: 1234)
3. Verify firewall settings

### Model Not Found

1. Load a model in LM Studio first
2. Check model compatibility
3. Verify model format (GGUF)
