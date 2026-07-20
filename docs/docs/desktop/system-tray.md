# System Tray

Alpaca runs in the system tray for quick access.

## Tray Icon

The tray icon shows:
- **Normal**: Application is running
- **Animated**: Model is generating
- **Warning**: Error occurred
- **Offline**: Server not running

## Tray Menu

Right-click the tray icon for:
- **Show Window** — Bring app to foreground
- **New Conversation** — Start a chat
- **Server Status** — Check if server is running
- **Documentation** — Open docs viewer
- **Settings** — Open preferences
- **Quit** — Exit application

## Platform-Specific Behavior

### Windows
- Tray icon in notification area
- Left-click opens window
- Right-click shows menu
- Supports Windows notifications

### macOS
- Tray icon in menu bar
- Supports macOS dark mode
- Native notification integration

### Linux
- Tray icon in system tray
- Supports AppIndicator
- Desktop notification support

## Configuration

### Hide to Tray on Close

Settings > Behavior > Minimize to tray on close

### Start Minimized

Settings > Behavior > Start minimized to tray

### Notifications

Settings > Notifications > Enable tray notifications

## Troubleshooting

### Tray Icon Not Visible

**Linux**: Ensure `libappindicator` is installed

**Windows**: Check notification area settings

**macOS**: Check menu bar preferences

### Notifications Not Working

1. Check OS notification permissions
2. Verify notification settings in app
3. Restart the application
