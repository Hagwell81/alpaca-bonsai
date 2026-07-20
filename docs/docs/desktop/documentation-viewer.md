---
sidebar_position: 5
title: Documentation Viewer
description: Access documentation from within the desktop app
---

# Documentation Viewer

The Documentation Viewer allows you to access this entire documentation site directly from within the Alpaca desktop application, without needing to open a web browser.

## Accessing Documentation

### From Menu Bar
1. Click **Help** in the menu bar
2. Select **Documentation**
3. The documentation site opens in a new window

### From Tray Menu
1. Right-click the Alpaca tray icon
2. Select **Documentation**
3. The documentation site opens

### Keyboard Shortcut
- **Windows/Linux**: `Ctrl+Shift+?`
- **macOS**: `Cmd+Shift+?`

## Features

### Offline Access
- Documentation is cached locally
- Works without internet connection
- Automatic updates when online

### Full-Text Search
- Search across all documentation
- Keyboard shortcut: `Ctrl+K` (Windows/Linux) or `Cmd+K` (macOS)
- Instant results as you type

### Dark Mode
- Automatically matches application theme
- Toggle in documentation viewer settings
- Respects system preferences

### Navigation
- Breadcrumb navigation at top
- Sidebar with full table of contents
- Previous/Next article links
- Related articles suggestions

### Code Examples
- Copy code blocks with one click
- Syntax highlighting for all languages
- Language-specific examples

## Window Management

### Open in New Window
Documentation opens in a separate window that:
- Stays on top of main application
- Can be resized and repositioned
- Remembers size and position

### Docking
You can dock the documentation viewer:
1. Click the dock icon in the documentation window
2. Choose position (right, bottom, or floating)
3. Resize as needed

### Closing
- Click the X button to close
- Use `Esc` key
- Close from tray menu

## Customization

### Font Size
1. Open documentation viewer
2. Click settings icon (⚙️)
3. Adjust font size slider
4. Changes apply immediately

### Theme
1. Click settings icon (⚙️)
2. Select theme (Light, Dark, Auto)
3. Changes apply immediately

### Language
1. Click settings icon (⚙️)
2. Select language (English, more coming)
3. Documentation reloads in selected language

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open search |
| `Esc` | Close search or documentation |
| `Ctrl+Shift+?` / `Cmd+Shift+?` | Toggle documentation viewer |
| `Ctrl+F` / `Cmd+F` | Find on page |
| `Ctrl++` / `Cmd++` | Increase font size |
| `Ctrl+-` / `Cmd+-` | Decrease font size |
| `Ctrl+0` / `Cmd+0` | Reset font size |

## Offline Mode

### Automatic Caching
- Documentation is cached on first access
- Cache updates automatically when online
- Cached version used when offline

### Cache Management
1. Go to **Settings** > **Documentation**
2. Click **Manage Cache**
3. View cache size and last update
4. Click **Clear Cache** to reset

### Checking Connection
- Green indicator = Online
- Gray indicator = Offline
- Documentation still accessible offline

## Troubleshooting

### Documentation Won't Load
1. Check internet connection
2. Try clearing cache: Settings > Documentation > Clear Cache
3. Restart the application
4. Check GitHub issues if problem persists

### Search Not Working
1. Ensure documentation is fully loaded
2. Try refreshing: `Ctrl+R` / `Cmd+R`
3. Clear cache and reload

### Slow Performance
1. Clear cache
2. Reduce font size
3. Disable animations in settings
4. Close other applications

## Updating Documentation

### Automatic Updates
- Documentation updates automatically
- Checks for updates on startup
- Can be disabled in settings

### Manual Update
1. Click settings icon (⚙️)
2. Click **Check for Updates**
3. Install if available

### Version Info
- Current version shown in settings
- Last update timestamp displayed
- Release notes available

## Linking from Application

### From Chat Interface
When discussing features, you can:
1. Click **Learn More** links in tooltips
2. Links open relevant documentation section
3. Context-aware documentation suggestions

### From Settings
Each setting has:
- Help icon (?) with brief description
- **Learn More** link to detailed documentation
- Examples and best practices

### From Error Messages
Error messages include:
- Explanation of the issue
- **Learn More** link to troubleshooting guide
- Suggested solutions

## Developer Integration

### Adding Help Links
In your code, add help links:

```typescript
<HelpLink 
  docPath="/docs/api-management/overview"
  label="Learn about API Management"
/>
```

### Context-Aware Documentation
Request specific documentation sections:

```typescript
await window.llamaAPI.openDocumentation({
  path: '/docs/api-management/openai',
  highlight: 'api-key-setup'
});
```

### Embedding Documentation
Embed documentation sections in dialogs:

```typescript
<DocumentationEmbed 
  path="/docs/getting-started/quick-start"
  maxHeight="400px"
/>
```

## Next Steps

- **[System Tray](./system-tray.md)** - Access documentation from tray
- **[Getting Started](../getting-started/)** - Learn the basics
