---
sidebar_position: 3
title: API Integration Guide
description: Integrate Alpaca with external applications and systems
---

# API Integration Guide

Alpaca exposes an OpenAI-compatible REST API at `http://localhost:13434/v1`, making it easy to integrate with existing tools, IDEs, and custom applications.

## Base Configuration

| Property | Value | Description |
|----------|-------|-------------|
| **Base URL** | `http://localhost:13434/v1` | API root endpoint |
| **Protocol** | HTTP / WebSocket | REST and real-time streams |
| **Authentication** | Bearer token (optional) | API key in Authorization header |
| **Content-Type** | `application/json` | Request body format |

## Authentication

### No Authentication (Default)

For local development, the API is open:

```bash
curl http://localhost:13434/v1/models
```

### API Key Authentication

When enabled in settings, include the key in requests:

```bash
curl http://localhost:13434/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-3", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Core Endpoints

### Chat Completions

The primary endpoint for conversational AI:

```http
POST /v1/chat/completions
```

**Request Body:**

```json
{
  "model": "llama-3-8b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is machine learning?" }
  ],
  "temperature": 0.7,
  "max_tokens": 2048,
  "stream": true,
  "top_p": 0.9,
  "top_k": 40,
  "repeat_penalty": 1.1,
  "presence_penalty": 0.0,
  "frequency_penalty": 0.0,
  "stop": ["###", "<|endoftext|>"],
  "seed": 42,
  "mirostat": 2,
  "mirostat_tau": 5.0,
  "mirostat_eta": 0.1
}
```

**Parameters Reference:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | required | Model ID to use |
| `messages` | array | required | Conversation history |
| `temperature` | float | 0.8 | Sampling temperature (0.0–2.0) |
| `max_tokens` | integer | null | Maximum tokens to generate |
| `stream` | boolean | false | Enable SSE streaming |
| `top_p` | float | 0.9 | Nucleus sampling threshold |
| `top_k` | integer | 40 | Top-K sampling |
| `min_p` | float | 0.05 | Minimum probability threshold |
| `repeat_penalty` | float | 1.1 | Penalty for repeated tokens |
| `presence_penalty` | float | 0.0 | Presence penalty (-2.0 to 2.0) |
| `frequency_penalty` | float | 0.0 | Frequency penalty (-2.0 to 2.0) |
| `stop` | string/array | null | Stop sequences |
| `seed` | integer | null | Random seed for reproducibility |
| `mirostat` | integer | 0 | Mirostat mode (0=off, 1/2) |
| `mirostat_tau` | float | 5.0 | Target perplexity |
| `mirostat_eta` | float | 0.1 | Learning rate |
| `dynatemp_range` | float | 0.0 | Dynamic temperature range |
| `dynatemp_exponent` | float | 1.0 | Dynamic temperature exponent |
| `xtc_probability` | float | 0.0 | XTC removal probability |
| `xtc_threshold` | float | 0.1 | XTC threshold |
| `typ_p` | float | 1.0 | Typical sampling parameter |
| `dry_multiplier` | float | 0.0 | DRY penalty multiplier |
| `dry_base` | float | 1.75 | DRY penalty base |
| `dry_allowed_length` | integer | 2 | DRY allowed length |
| `dry_penalty_last_n` | integer | -1 | DRY penalty window |
| `samplers` | string | null | Custom sampler chain |
| `grammar` | string | null | Formal grammar constraint |
| `grammar_lazy` | boolean | false | Lazy grammar evaluation |
| `n_probs` | integer | 0 | Return top N token probabilities |
| `n_keep` | integer | 0 | Tokens to keep from prompt |
| `n_discard` | integer | 0 | Tokens to discard from input |
| `ignore_eos` | boolean | false | Ignore end-of-sequence token |
| `custom` | object | null | Custom backend parameters |

**Non-Streaming Response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "llama-3-8b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Machine learning is a subset of artificial intelligence..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

### Streaming (SSE)

Set `stream: true` for real-time token-by-token responses:

```bash
curl -N http://localhost:13434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-8b",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Stream Format:**

```
data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1704067200,"model":"llama-3-8b","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1704067200,"model":"llama-3-8b","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1704067200,"model":"llama-3-8b","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1704067200,"model":"llama-3-8b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### List Models

```http
GET /v1/models
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "llama-3-8b",
      "object": "model",
      "created": 1704067200,
      "owned_by": "meta"
    },
    {
      "id": "qwen2.5-7b",
      "object": "model",
      "created": 1704067200,
      "owned_by": "alibaba"
    }
  ]
}
```

### Model Info

```http
GET /v1/models/{model_id}
```

**Response:**

```json
{
  "id": "llama-3-8b",
  "object": "model",
  "created": 1704067200,
  "owned_by": "meta",
  "parameters": "8B",
  "quantization": "Q4_K_M",
  "context_length": 8192,
  "modality": ["text"]
}
```

### Embeddings

```http
POST /v1/embeddings
```

**Request:**

```json
{
  "model": "llama-3-8b",
  "input": "The quick brown fox"
}
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.0123, -0.0456, ...],
      "index": 0
    }
  ],
  "model": "llama-3-8b",
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 5
  }
}
```

### Health Check

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-05-03T12:00:00Z",
  "version": "1.1.0",
  "model_loaded": true,
  "model": "llama-3-8b"
}
```

## SDK Examples

### Python

```python
from openai import OpenAI

# Initialize client
client = OpenAI(
    base_url="http://localhost:13434/v1",
    api_key="not-needed"  # or your API key
)

# Simple chat
response = client.chat.completions.create(
    model="llama-3-8b",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ],
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="llama-3-8b",
    messages=[{"role": "user", "content": "Tell me a joke"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### JavaScript/TypeScript

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:13434/v1',
  apiKey: 'not-needed'
});

// Simple chat
const response = await client.chat.completions.create({
  model: 'llama-3-8b',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);

// Streaming with fetch
const res = await fetch('http://localhost:13434/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-3-8b',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true
  })
});

const reader = res.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

  for (const line of lines) {
    const data = line.slice(6);
    if (data === '[DONE]') continue;

    const parsed = JSON.parse(data);
    const content = parsed.choices[0]?.delta?.content;
    if (content) process.stdout.write(content);
  }
}
```

### cURL

```bash
# Simple request
curl http://localhost:13434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-8b",
    "messages": [{"role": "user", "content": "Hi!"}]
  }'

# Streaming request
curl -N http://localhost:13434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-8b",
    "messages": [{"role": "user", "content": "Count to 10"}],
    "stream": true
  }'
```

### C#

```csharp
using System.Net.Http.Json;
using System.Text.Json;

var client = new HttpClient();
var request = new
{
    model = "llama-3-8b",
    messages = new[]
    {
        new { role = "user", content = "Hello!" }
    }
};

var response = await client.PostAsJsonAsync(
    "http://localhost:13434/v1/chat/completions",
    request
);

var result = await response.Content.ReadFromJsonAsync<JsonElement>();
Console.WriteLine(result.GetProperty("choices")[0]
    .GetProperty("message")
    .GetProperty("content")
    .GetString());
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type ChatRequest struct {
    Model    string    `json:"model"`
    Messages []Message `json:"messages"`
}

type Message struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

func main() {
    reqBody := ChatRequest{
        Model: "llama-3-8b",
        Messages: []Message{
            {Role: "user", Content: "Hello!"},
        },
    }

    jsonData, _ := json.Marshal(reqBody)
    resp, _ := http.Post(
        "http://localhost:13434/v1/chat/completions",
        "application/json",
        bytes.NewBuffer(jsonData),
    )

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    fmt.Println(result["choices"].([]interface{})[0].(map[string]interface{})["message"].(map[string]interface{})["content"])
}
```

## Error Handling

### Common Error Codes

| HTTP Status | Error Type | Description | Resolution |
|-------------|------------|-------------|------------|
| `400` | `invalid_request_error` | Malformed request | Check request body format |
| `401` | `authentication_error` | Invalid API key | Verify Authorization header |
| `404` | `not_found` | Model not found | Check model ID in `/v1/models` |
| `422` | `validation_error` | Invalid parameters | Check parameter types and ranges |
| `429` | `rate_limit_error` | Too many requests | Wait and retry |
| `500` | `server_error` | Internal server error | Check server logs |
| `503` | `service_unavailable` | Server overloaded | Reduce concurrent requests |

**Error Response Format:**

```json
{
  "error": {
    "message": "Model 'unknown-model' not found",
    "type": "not_found",
    "code": 404
  }
}
```

### Retry Strategy

Implement exponential backoff for resilience:

```python
import time
from openai import OpenAI

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")

for attempt in range(5):
    try:
        response = client.chat.completions.create(
            model="llama-3-8b",
            messages=[{"role": "user", "content": "Hello!"}]
        )
        break
    except Exception as e:
        if attempt == 4:
            raise
        wait = 2 ** attempt
        print(f"Retry {attempt + 1}/5 after {wait}s...")
        time.sleep(wait)
```

## Context Management

### Conversation State

The API is stateless — you must include the full conversation history in each request:

```json
{
  "model": "llama-3-8b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is Python?" },
    { "role": "assistant", "content": "Python is a programming language..." },
    { "role": "user", "content": "What are its main features?" }
  ]
}
```

### Token Counting

Estimate token count before sending:

```bash
curl http://localhost:13434/v1/tokenize \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-3-8b", "text": "Hello world"}'
```

### Context Window

Be mindful of the model's context length:

| Model | Context Length |
|-------|----------------|
| Llama 3.1/3.2 | 128K tokens |
| Llama 3 | 8K tokens |
| Qwen2.5 | 128K tokens |
| Mistral | 32K tokens |

If your conversation exceeds the limit, the oldest tokens (excluding `n_keep`) are discarded.

## Best Practices

### 1. Reuse Connections

Use HTTP keep-alive or connection pooling to reduce latency:

```python
# Python with httpx
import httpx

client = httpx.Client(http2=True, limits=httpx.Limits(max_connections=10))
```

### 2. Handle Streaming Correctly

Always process SSE streams incrementally:

```javascript
// Parse SSE events properly
const lines = chunk.split('\n');
for (const line of lines) {
  if (line.startsWith('data: ')) {
    const data = line.slice(6);
    if (data === '[DONE]') break;
    const parsed = JSON.parse(data);
    // Process parsed chunk
  }
}
```

### 3. Set Reasonable Timeouts

```python
# Python
client = OpenAI(
    base_url="http://localhost:13434/v1",
    api_key="not-needed",
    timeout=300.0  # 5 minutes for long generations
)
```

### 4. Monitor Server Health

Poll the health endpoint before making requests:

```bash
# Check server is ready
curl -s http://localhost:13434/health | jq '.status'
```

### 5. Use Appropriate Parameters

| Use Case | Temperature | Top P | Max Tokens |
|----------|-------------|-------|------------|
| Factual QA | 0.1 – 0.3 | 0.5 | 512 |
| Creative Writing | 0.7 – 1.0 | 0.9 | 2048 |
| Code Generation | 0.2 – 0.4 | 0.8 | 1024 |
| Summarization | 0.1 – 0.3 | 0.5 | 256 |
| Brainstorming | 0.8 – 1.2 | 0.95 | 1024 |

## Next Steps

- **[WebSocket API](../api/websocket.md)** — Real-time communication
- **[IPC Channels](../api/ipc-channels.md)** — Desktop app integration
- **[Authentication](../api/authentication.md)** — API key management
- **[Developer Guide](../development/architecture.md)** — Build custom integrations
