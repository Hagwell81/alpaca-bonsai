# VS Code Integration

## Continue

Add to `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Bonsai 27B",
      "provider": "openai",
      "model": "bonsai-27b",
      "apiBase": "http://127.0.0.1:15452/v1",
      "apiKey": "bonsai"
    }
  ]
}
```

## Roo Code

Open Roo Code settings and add an OpenAI-compatible provider:

- Provider: `OpenAI`
- API Base URL: `http://127.0.0.1:15452/v1`
- API Key: `bonsai`
- Model: `bonsai-27b`

Enable tool calling in Roo Code for the 27B.

## GitHub Copilot Chat

Use the VS Code "Copilot Models" custom model feature (if available in your
build) to point Copilot Chat at `http://127.0.0.1:15452/v1` with model
`bonsai-27b`.
