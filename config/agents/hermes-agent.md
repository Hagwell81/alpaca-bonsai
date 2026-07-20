# Hermes-agent Integration

Hermes-agent includes a `custom` provider profile (aliases `llamacpp`,
`llama.cpp`, `ollama`, `vllm`) that is purpose-built for OpenAI-compatible local
endpoints.

Add to your Hermes `config.yaml` or run `hermes setup`:

```yaml
providers:
  - name: Alpaca
    type: custom
    base_url: http://127.0.0.1:15452/v1
    model: bonsai-27b
    api_key: bonsai
```

The custom profile will automatically emit the correct `reasoning_effort` and
`extra_body.think` fields for the 27B reasoning mode.

For the 8B model use `http://127.0.0.1:15453/v1`.
