# VS Code Integration

Connect Alpaca to Visual Studio Code.

## Setup

1. Install the Alpaca VS Code extension
2. Open VS Code settings
3. Set API endpoint to `http://localhost:13434/v1`
4. Configure model preference

## Settings

```json
{
  "alpaca.apiEndpoint": "http://localhost:13434/v1",
  "alpaca.model": "llama-3-8b",
  "alpaca.temperature": 0.7
}
```

## Features

- Inline code completion
- Chat sidebar
- Code explanation
- Refactoring suggestions

## Commands

- `Alpaca: Explain` — Explain selected code
- `Alpaca: Refactor` — Refactor selected code
- `Alpaca: Generate` — Generate from prompt
- `Alpaca: Chat` — Open chat panel

## Troubleshooting

If VS Code cannot connect:
- Verify Alpaca server is running
- Check port matches (13434)
- Test endpoint in browser
