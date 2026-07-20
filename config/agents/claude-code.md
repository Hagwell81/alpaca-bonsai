# Claude Code Integration

Alpaca supports Claude Code in two ways:

## Option 1: Anthropic Messages API (recommended)

Enable the Anthropic shim in your config:

```toml
[anthropic_shim]
enabled = true
port = 15457
```

Then set:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:15457
export ANTHROPIC_API_KEY=bonsai
export CLAUDE_MODEL=bonsai-27b
```

The shim translates the Anthropic Messages API format to the OpenAI Chat
Completions format used by the `llama-server` backend, so Claude Code works
without any client-side changes.

## Option 2: OpenAI-compatible endpoint

If your Claude Code build supports pointing at an OpenAI-compatible endpoint:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:15452/v1
export ANTHROPIC_API_KEY=bonsai
export CLAUDE_MODEL=bonsai-27b
```

## Tips

- Use the 27B model for tool calling and vision.
- The 8B model (`http://127.0.0.1:15453/v1`) is lighter but has no vision.
- Reasoning is enabled on the 27B via `--jinja` and `reasoning_budget`.
- Streaming is supported through the Anthropic shim.
