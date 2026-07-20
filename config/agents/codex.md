# Codex (OpenAI Codex CLI) Integration

Set the standard OpenAI env vars to point Codex at the 27B model:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:15452/v1
export OPENAI_API_KEY=bonsai
export OPENAI_MODEL=bonsai-27b
```

Then run:

```bash
codex
```

Codex speaks native OpenAI Chat Completions, so it works directly with the
`llama-server` backend.
