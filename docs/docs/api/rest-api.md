# REST API Reference

Complete reference for the Alpaca HTTP API.

:::tip Interactive Documentation
Explore the API interactively with the **[API Explorer &#8599;](/api-explorer)** powered by Swagger UI.
:::

## Two API Layers

Alpaca exposes two HTTP layers. Most clients should target the **API Gateway**, which adds slot routing, tool-rewriting, image generation, and model management on top of the underlying llama-server.| Layer | Default URL | Purpose |
|-------|-------------|---------|
| **API Gateway** | `http://127.0.0.1:13439` | Unified proxy with slot routing, tool rewriting, image generation, and `/v1/desktop/*` model management. **Recommended for all clients.** |
| **llama-server** | `http://127.0.0.1:13434` | The raw llama-server process (slot 0). The gateway proxies to this. Useful for direct debugging. |

The gateway speaks three protocol families, all on port `13439`:

| Protocol | Base URL | Compatible With |
|----------|----------|-----------------|
| **OpenAI** | `http://127.0.0.1:13439/v1` | OpenAI SDK, Continue, Cursor, Copilot Chat, Codex, Cline, OpenCode, Goose, Pi, Pool, Zed, JetBrains, Xcode, Onyx, n8n, marimo |
| **Anthropic** | `http://127.0.0.1:13439` (endpoint: `/v1/messages`) | Claude Code, Anthropic SDK |
| **Ollama** | `http://127.0.0.1:13439/api` | Any Ollama-native client (Ollama SDK, `ollama` CLI integrations) |

The examples below use the gateway (`13439`). To target llama-server directly, swap the port to `13434` and drop the `/v1/desktop/*`, `/v1/images/*`, `/v1/messages`, and `/api/*` endpoints (those are gateway-only).

## Authentication

By default no API key is required. When the API server is configured to require a key, send it in the `Authorization` header:

```
Authorization: Bearer your-api-key
```

Some clients (e.g. Claude Code, Copilot CLI) require *some* API key value — use `alpaca` or `ollama` as a placeholder.

## OpenAI-Compatible Endpoints

### Chat Completions

```
POST /v1/chat/completions
```

Supports both streaming (`stream: true`, SSE) and non-streaming responses. Includes automatic tool-call rewriting for local models that emit tool calls as text.

**Request**:

```json
{
  "model": "bonsai-27b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false,
  "reasoning_format": "auto"
}
```

**Response** (non-streaming):

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "bonsai-27b",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30 }
}
```

**Streaming**: Set `"stream": true` to receive Server-Sent Events. Each `data:` line contains a JSON chunk with a `delta` object. See [Tool Calling](./tool-calling.md) for streaming tool-call delta accumulation.

**Reasoning format**: Set `"reasoning_format": "auto"` to extract chain-of-thought into a separate `reasoning_content` field (useful for reasoning models like DeepSeek-R1 and Bonsai). Other values: `"none"` (inline), `"deepseek"`.

### Completions (Legacy)

```
POST /v1/completions
```

OpenAI-compatible text completions (no chat template). Same request/response shape as the OpenAI completions API.

### Embeddings

```
POST /v1/embeddings
```

```json
{
  "model": "bonsai-27b",
  "input": "Hello world"
}
```

Used by the Knowledge Base RAG system for document indexing and semantic search.

### List Models

```
GET /v1/models
```

```json
{
  "object": "list",
  "data": [
    { "id": "bonsai-27b", "object": "model", "created": 1704067200, "owned_by": "bonsai" }
  ]
}
```

In **router mode** this returns all loaded models. In **MODEL mode** it returns the single loaded model.

### Slots Status

```
GET /v1/slots/status
```

Returns the status of all model slots (loaded model, VRAM usage, busy state). Useful for monitoring multi-model setups.

## llama-server Native Endpoints

These endpoints are proxied through the gateway but match the raw llama-server API:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/tokenize` | POST | Tokenize text into token IDs |
| `/detokenize` | POST | Convert token IDs back to text |
| `/health` | GET | Server health check |
| `/metrics` | GET | Prometheus-style metrics |
| `/props` | GET | Server properties (default sampling params, modalities, model path, context size) |

## Image Generation (Gateway-Only)

:::note
Image generation requires the sd.cpp binary and the Bonsai Image 4B model. These are downloaded automatically during onboarding or on first use.
:::

### Generate Image

```
POST /v1/images/generations
```

```json
{
  "prompt": "A serene mountain landscape at sunset",
  "steps": 30,
  "cfg": 7.5,
  "sampler": "euler_a",
  "seed": -1,
  "width": 512,
  "height": 512
}
```

Returns a job ID. Generation runs asynchronously in the background.

### Image Status

```
GET /v1/images/status
```

Returns the image service status (ready, sd-cli path, loaded model).

## Desktop Model Management (Gateway-Only)

These endpoints mirror the Electron IPC handlers so the standalone webui (running outside Electron) can manage models via HTTP. They return `503` with `{ "error": "desktop_services_unavailable" }` when the desktop backend is not running.

CORS is permissive (`Access-Control-Allow-Origin: *`) for all `/v1/desktop/*` paths so a browser-based webui on a different origin can call them.

| Endpoint | Method | Body / Query | Description |
|----------|--------|--------------|-------------|
| `/v1/desktop/installed-models` | GET | — | List installed GGUF models (excludes mmproj) |
| `/v1/desktop/huggingface/search` | POST | `{ repoId, hfToken? }` | Search a HuggingFace repo for GGUF files |
| `/v1/desktop/huggingface/download` | POST | `{ repoId, filename, hfToken? }` | Start a background download. Returns `{ downloadId, started }` |
| `/v1/desktop/download-progress` | GET | `?downloadId=...` | Poll progress of an in-progress download |
| `/v1/desktop/models/delete` | POST | `{ filename }` | Delete an installed model file |

See [Tool Calling](./tool-calling.md) for a detailed example of using these endpoints from an external app.

## Anthropic-Compatible Endpoints (Gateway-Only)

The gateway implements the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) so Claude Code and the Anthropic SDK can use Alpaca as a backend without any shim or proxy. Requests are translated to OpenAI chat completions internally, then responses are translated back to Anthropic format.

### Create a Message

```
POST /v1/messages
```

**Request** (non-streaming):

```json
{
  "model": "bonsai-27b",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}
```

**Response**:

```json
{
  "id": "msg_alpaca_abc123",
  "type": "message",
  "role": "assistant",
  "model": "bonsai-27b",
  "content": [
    { "type": "text", "text": "Hello! How can I help?" }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": { "input_tokens": 12, "output_tokens": 8 }
}
```

**Streaming**: Set `"stream": true` to receive Server-Sent Events with the standard Anthropic event sequence: `message_start` → `content_block_start` → `content_block_delta` (text_delta / thinking_delta / input_json_delta) → `content_block_stop` → `message_delta` → `message_stop`.

**Supported features**:
- `system` (string or array of text blocks)
- `content` blocks: `text`, `image` (base64), `tool_use`, `tool_result`
- `tools` with `input_schema` (converted to OpenAI function tools)
- `thinking: { type: "enabled" }` (mapped to `reasoning_format: "auto"`)
- `stop_sequences`, `temperature`, `top_p`
- `max_tokens` (required by Anthropic, mapped to OpenAI `max_tokens`)

### Claude Code Setup

```bash
export ANTHROPIC_BASE_URL=http://localhost:13439
export ANTHROPIC_API_KEY=""
export ANTHROPIC_AUTH_TOKEN=alpaca
claude --model bonsai-27b
```

Or use the desktop app's **Integrations** panel → Claude Code → **Configure** to generate the env file automatically.

### Anthropic SDK (Python)

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:13439",
    api_key="alpaca",
)

message = client.messages.create(
    model="bonsai-27b",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

## Ollama-Compatible Endpoints (Gateway-Only)

The gateway implements the [Ollama HTTP API](https://github.com/ollama/ollama/blob/main/docs/api.md) so any Ollama-native client can use Alpaca as a backend. Requests are translated to the gateway's OpenAI-compatible endpoints internally, then responses are translated back to Ollama format.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tags` | GET | List local models (Ollama format) |
| `/api/ps` | GET | List running models |
| `/api/version` | GET | Get server version |
| `/api/show` | POST | Show model details |
| `/api/chat` | POST | Chat completion (streaming or non-streaming) |
| `/api/generate` | POST | Text generation (streaming or non-streaming) |
| `/api/embed` | POST | Generate embeddings |
| `/api/embeddings` | POST | Alias for `/api/embed` (backwards compat) |

### Chat (`/api/chat`)

```json
{
  "model": "bonsai-27b",
  "messages": [{ "role": "user", "content": "Why is the sky blue?" }],
  "stream": false
}
```

**Response**:

```json
{
  "model": "bonsai-27b",
  "created_at": "2026-07-20T12:00:00Z",
  "message": { "role": "assistant", "content": "The sky is blue because of Rayleigh scattering." },
  "done": true,
  "done_reason": "stop",
  "prompt_eval_count": 8,
  "eval_count": 12
}
```

**Streaming**: Set `"stream": true` (the default) to receive newline-delimited JSON objects, each containing a partial response. The final object has `"done": true` and includes generation statistics.

### Generate (`/api/generate`)

```json
{
  "model": "bonsai-27b",
  "prompt": "Why is the sky blue?",
  "stream": false
}
```

**Response**: Same shape as `/api/chat` but with `response` instead of `message`.

### Supported Ollama features

- `model`, `messages`, `prompt`, `system`
- `options`: `temperature`, `top_p`, `top_k`, `seed`, `num_predict`, `stop`, `repeat_penalty`, `presence_penalty`, `frequency_penalty`
- `format`: `"json"` or a JSON schema object (mapped to `response_format`)
- `tools` (function calling, mapped to OpenAI tools)
- `think`: `true` (mapped to `reasoning_format: "auto"`)
- `images`: base64-encoded images for multimodal models
- `stream`: streaming (newline-delimited JSON) or non-streaming

### Ollama SDK (Python)

```python
import ollama

client = ollama.Client(host="http://localhost:13439")

response = client.chat(model="bonsai-27b", messages=[
    {"role": "user", "content": "Hello!"},
])
print(response["message"]["content"])
```

### curl

```bash
# List models
curl http://localhost:13439/api/tags

# Chat (non-streaming)
curl http://localhost:13439/api/chat -d '{
  "model": "bonsai-27b",
  "messages": [{"role": "user", "content": "Hello!"}],
  "stream": false
}'

# Version
curl http://localhost:13439/api/version
```

## Tool Calling

The chat completions endpoint supports the OpenAI-compatible `tools` field for function calling. See the dedicated [Tool Calling](./tool-calling.md) page for the full protocol, streaming delta accumulation, built-in TUI tools, and external app integration examples.

## Error Responses

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error",
    "code": 401
  }
}
```

## SDK Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:13439/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="bonsai-27b",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### JavaScript (fetch)

```javascript
const response = await fetch('http://localhost:13439/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'bonsai-27b',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse SSE lines: data: {...}\n\n
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const json = JSON.parse(line.slice(6));
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) process.stdout.write(delta);
    }
  }
}
```

### curl

```bash
curl http://localhost:13439/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bonsai-27b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## See Also

- [Tool Calling](./tool-calling.md) — Function calling protocol and built-in tools
- [IPC Channels](./ipc-channels.md) — Electron IPC bridge (`window.llamaAPI`)
- [Authentication](./authentication.md) — API key configuration
- [Integrations](../integrations.md) — 24+ third-party tools that connect to the API
