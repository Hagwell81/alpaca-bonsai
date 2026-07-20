# Custom Endpoints

Connect to any OpenAI-compatible API endpoint.

## Overview

Alpaca supports any API that follows the OpenAI API specification.

## Configuration

```json
{
  "providers": {
    "custom": {
      "enabled": true,
      "baseUrl": "https://your-api.example.com/v1",
      "apiKey": "your-key",
      "model": "your-model-name"
    }
  }
}
```

## Compatible Services

- **Local servers**: llama.cpp, text-generation-webui
- **Cloud providers**: Any OpenAI-compatible API
- **Proxies**: LiteLLM, Cloudflare AI Gateway

## Example: Local llama.cpp Server

```json
{
  "providers": {
    "local": {
      "enabled": true,
      "baseUrl": "http://localhost:8080/v1",
      "apiKey": "not-needed",
      "model": "llama-3-8b"
    }
  }
}
```

## Testing Connection

```bash
curl http://your-endpoint/v1/models \
  -H "Authorization: Bearer your-key"
```
