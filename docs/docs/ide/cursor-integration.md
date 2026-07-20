# Cursor IDE Integration

Use Alpaca with Cursor editor.

## Setup

1. Open Cursor Settings
2. Go to AI Provider settings
3. Set API endpoint to `http://localhost:13434/v1`
4. Use any string for API key (local server)

## Configuration

```json
{
  "provider": "custom",
  "apiEndpoint": "http://localhost:13434/v1",
  "apiKey": "not-needed"
}
```

## Features

- Code completions
- Inline chat
- Command palette
- Tab completion

## Models

Select any loaded model in Cursor:
- llama-3-8b for fast responses
- code-llama for code tasks
- mistral-7b for general use

## Troubleshooting

If connection fails:
- Verify Alpaca is running
- Check server port (13434)
- Test endpoint with curl
