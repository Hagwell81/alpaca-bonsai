# Debugging Guide

Tips and techniques for debugging Alpaca.

## Desktop App Debugging

### Developer Tools

Open DevTools in the Electron app:
- **Windows/Linux**: `Ctrl + Shift + I`
- **macOS**: `Cmd + Option + I`
- **Menu**: View > Toggle Developer Tools

### Console Logging

View logs in the Developer Tools console:

```javascript
// In main process
console.log('Server starting...');
console.error('Failed to start:', error);

// In renderer
console.log('Component mounted');
```

### Main Process Debugging

Start with debugging enabled:

```bash
cd desktop
npm start -- --inspect=9229
```

Then attach Chrome DevTools to `chrome://inspect`.

### Log Files

Logs are stored in:
- **Windows**: `%APPDATA%\Alpaca\logs\`
- **macOS**: `~/Library/Logs/Alpaca/`
- **Linux**: `~/.config/Alpaca/logs/`

## Server Debugging

### Verbose Logging

Enable verbose logging:

```json
{
  "debug": {
    "verbose": true,
    "logLevel": "debug"
  }
}
```

### API Requests

Log all API requests:

```bash
# Using curl with verbose output
curl -v http://localhost:13434/v1/models
```

### Health Checks

```bash
curl http://localhost:13434/health
curl http://localhost:13434/v1/models
```

## Web UI Debugging

### Browser DevTools

The web UI uses Svelte. Debug with:
- Chrome DevTools
- Svelte DevTools extension
- React DevTools (for compatibility)

### Network Requests

Use the Network tab in DevTools to inspect:
- API calls
- WebSocket messages
- Static asset loading

### State Inspection

Use the Svelte store inspector:
```javascript
// In console
$store_name
```

## Common Issues

### Server Won't Start

1. Check if port 13434 is already in use
2. Verify model file exists
3. Check logs for errors
4. Try starting with different model

### Blank Screen

1. Check DevTools for JavaScript errors
2. Verify web UI built successfully
3. Check file paths in main.js

### API Errors

1. Check server is running
2. Verify API key (if using cloud provider)
3. Check request format
4. Review rate limits

## Profiling

### Performance Profiling

Use Chrome DevTools Performance tab to:
- Profile JavaScript execution
- Identify slow functions
- Analyze memory usage

### Memory Leaks

Use the Memory tab to:
- Take heap snapshots
- Compare snapshots
- Find retained objects

## Remote Debugging

### Enable Remote Debugging

```json
{
  "debug": {
    "remoteDebugging": true,
    "port": 9222
  }
}
```

Connect from another machine:
```bash
chrome --remote-debugging-port=9222
```
