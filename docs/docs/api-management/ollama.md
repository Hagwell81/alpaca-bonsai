# Ollama

Run and manage local models with Ollama integration.

## Overview

Ollama makes it easy to run LLMs locally with a simple API.

## Configuration

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "baseUrl": "http://localhost:11434",
      "model": "llama3"
    }
  }
}
```

## Setup

1. Install [Ollama](https://ollama.com/)
2. Pull models: `ollama pull llama3`
3. Configure Alpaca

## Available Models

| Model | Command | Size |
|-------|---------|------|
| Llama 3 | `ollama pull llama3` | 4.7GB |
| Mistral | `ollama pull mistral` | 4.1GB |
| CodeLlama | `ollama pull codellama` | 3.8GB |
| Gemma | `ollama pull gemma` | 4.8GB |

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'llama3',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Features

- Easy model management
- OpenAI-compatible API
- Local processing
- Custom models
- Model creation from Modelfile
