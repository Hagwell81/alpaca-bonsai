# Tool Calling (Function Calling)

Alpaca supports OpenAI-compatible tool calling (also known as function calling), allowing external applications and the built-in TUI to let the model invoke structured tools during a conversation.

## Overview

Tool calling lets you describe functions to the model. The model can then decide to call those functions instead of (or in addition to) producing a text response. The caller executes the requested tools and sends the results back, allowing the model to ground its answers in real data.

This is the same protocol used by OpenAI, Anthropic, and other providers, so any client library that supports tool calling against the OpenAI API will work against Alpaca unchanged.

## Endpoints

Tool calling is supported on three protocol families, all on the API gateway at `127.0.0.1:13439`:

| Protocol | Endpoint | Tool Field |
|----------|----------|------------|
| OpenAI | `POST /v1/chat/completions` | `tools` (OpenAI format) |
| Anthropic | `POST /v1/messages` | `tools` with `input_schema` (Anthropic format) |
| Ollama | `POST /api/chat` | `tools` with `function.parameters` (Ollama format) |

The Anthropic and Ollama shims translate tool definitions and tool-call deltas to/from the OpenAI format internally, so tool calling works transparently across all three protocols. The gateway also applies automatic tool-rewriting for local models that emit tool calls as text rather than structured `tool_calls`.

## Request Format

Add a `tools` array to your `/v1/chat/completions` request:

```json
{
  "model": "bonsai-27b",
  "messages": [
    { "role": "user", "content": "What files are in the current directory?" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "list_dir",
        "description": "List the files and subdirectories in a directory.",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "Directory path" }
          },
          "required": ["path"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

- `tools` — array of tool definitions following the OpenAI schema.
- `tool_choice` — `"auto"` (default), `"none"`, `"required"`, or `{"type": "function", "function": {"name": "..."}}` to force a specific tool.

## Response Format

### Non-streaming

When the model decides to call a tool, the response includes a `tool_calls` array on the assistant message:

```json
{
  "choices": [
    {
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "list_dir",
              "arguments": "{\"path\": \".\"}"
            }
          }
        ]
      }
    }
  ]
}
```

### Streaming

In streaming responses, tool call arguments arrive incrementally in `delta.tool_calls[].function.arguments` chunks. Each chunk includes an `index` field so you can accumulate arguments for multiple concurrent tool calls:

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"list_dir","arguments":""}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\""}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path"}}]}}]}
...
data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}
data: [DONE]
```

## Returning Tool Results

After executing the tool, send a follow-up request with the assistant's tool-call message and a `tool` role message containing the result:

```json
{
  "model": "bonsai-27b",
  "messages": [
    { "role": "user", "content": "What files are in the current directory?" },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": { "name": "list_dir", "arguments": "{\"path\": \".\"}" }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "[FILE] README.md\n[FILE] package.json\n[DIR]  src"
    }
  ],
  "tools": [/* same tools array as before */],
  "stream": true
}
```

The model will then produce a final answer grounded in the tool result. You can repeat this loop for multi-step tool use.

## Built-in TUI Tools

The `alpaca-tui` ships with three built-in tools that are automatically sent on every chat request:

| Tool | Description |
|------|-------------|
| `read_file` | Read a text file from the workspace (truncated to 32 KB). |
| `list_dir` | List files and subdirectories in a workspace directory. |
| `web_fetch` | Fetch an HTTP(S) URL and return the response as text (truncated to 16 KB, HTML tags stripped). |

The TUI runs an agentic loop (capped at 8 iterations) that executes tool calls locally and feeds the results back to the model until it produces a final answer with no further tool calls. Tool calls and results are rendered inline in the chat as dimmed system messages.

## External App Integration

Any external application can use the same protocol against the Alpaca API. The general pattern is:

1. Define your tools as JSON in the `tools` field.
2. Send the request to `POST /v1/chat/completions`.
3. If the response includes `tool_calls`, execute them in your application.
4. Send a follow-up request with the tool results in `tool` role messages.
5. Repeat until the model produces a final answer.

### Example: Python with `openai` SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                },
                "required": ["city"]
            }
        }
    }
]

messages = [{"role": "user", "content": "What's the weather in Tokyo?"}]

while True:
    resp = client.chat.completions.create(
        model="bonsai-27b",
        messages=messages,
        tools=tools,
    )
    msg = resp.choices[0].message
    messages.append(msg)
    if not msg.tool_calls:
        print(msg.content)
        break
    for call in msg.tool_calls:
        # Execute the tool in your application
        result = execute_tool(call.function.name, call.function.arguments)
        messages.append({
            "role": "tool",
            "tool_call_id": call.id,
            "content": result,
        })
```

### Desktop Model Management via HTTP

In addition to the OpenAI-compatible chat endpoints, the API gateway on port `13439` exposes a small set of HTTP endpoints for model management. These mirror the Electron IPC handlers used by the desktop app, so the standalone webui (running outside Electron) can manage models without the IPC bridge.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| `GET`  | `/v1/desktop/installed-models` | — | List installed GGUF models (excludes mmproj vision projectors). |
| `POST` | `/v1/desktop/huggingface/search` | `{ repoId, hfToken? }` | Search a HuggingFace repo for GGUF files. |
| `POST` | `/v1/desktop/huggingface/download` | `{ repoId, filename, hfToken? }` | Start a background model download. Returns `{ downloadId, started }`. |
| `GET`  | `/v1/desktop/download-progress` | `?downloadId=...` | Poll the progress of an in-progress download. |
| `POST` | `/v1/desktop/models/delete` | `{ filename }` | Delete an installed model file. |

All endpoints return `503` with `{ "error": "desktop_services_unavailable" }` when the desktop backend is not running.

## See Also

- [REST API Reference](./rest-api.md) — Full endpoint reference
- [Authentication](./authentication.md) — API key configuration
- [Agentic Overview](../agentic/overview.md) — Higher-level agentic patterns
