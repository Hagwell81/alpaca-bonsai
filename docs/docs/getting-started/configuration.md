# Configuration Guide

Configure Alpaca to your preferences.

## Settings Overview

Settings are stored in:
- **Windows**: `%APPDATA%\Alpaca\settings.json`
- **macOS**: `~/Library/Application Support/Alpaca/settings.json`
- **Linux**: `~/.config/Alpaca/settings.json`

## Accessing Settings

- **Menu**: File > Preferences (or Ctrl+,)
- **Tray**: Right-click > Settings
- **Keyboard**: Ctrl + ,

## Categories

### General

| Setting | Description | Default |
|---------|-------------|---------|
| Theme | Light/Dark/System | System |
| Language | Interface language | English |
| Start on boot | Launch at system startup | false |
| Minimize to tray | Hide to tray on close | true |

### Models

| Setting | Description | Default |
|---------|-------------|---------|
| Model path | Where models are stored | ./models |
| Default model | Model to load on start | None |
| GPU layers | GPU offload layers | Auto |

### API Server

| Setting | Description | Default |
|---------|-------------|---------|
| Port | Server port | 13434 |
| Host | Bind address | 127.0.0.1 |
| CORS | Enable CORS | true |
| Authentication | Require API key | false |

### Chat

| Setting | Description | Default |
|---------|-------------|---------|
| Temperature | Creativity (0-2) | 0.7 |
| Max tokens | Response length limit | 4096 |
| Stream responses | Real-time output | true |
| Save history | Persist conversations | true |

### Appearance

| Setting | Description | Default |
|---------|-------------|---------|
| Font size | Chat font size | 14px |
| Code theme | Syntax highlighting | Dark |
| Show timestamps | Display message time | true |
| Compact mode | Reduced padding | false |

### Notifications

| Setting | Description | Default |
|---------|-------------|---------|
| Enable notifications | Show alerts | true |
| Sound effects | Play sounds | true |
| Focus on new message | Bring to front | false |

## Configuration File

Edit `settings.json` directly for advanced options:

```json
{
  "theme": "dark",
  "apiServer": {
    "port": 13434,
    "host": "0.0.0.0",
    "cors": true
  },
  "models": {
    "path": "./models",
    "defaultModel": "llama-3-8b"
  },
  "chat": {
    "temperature": 0.7,
    "maxTokens": 4096,
    "stream": true
  }
}
```

## Environment Variables

Override settings with environment variables:

| Variable | Setting |
|----------|---------|
| `ALPACA_PORT` | API server port |
| `ALPACA_MODELS_PATH` | Models directory |
| `ALPACA_DEBUG` | Enable debug mode |

## Resetting Settings

Reset to defaults:
1. Close Alpaca
2. Delete settings.json
3. Restart application

Or use menu: Help > Reset Settings
