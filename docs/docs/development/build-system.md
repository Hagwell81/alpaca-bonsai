# Build System

How the Alpaca build system works.

## Overview

The project uses a monorepo build system with:
- Root orchestration scripts
- Desktop app build
- Web UI build
- Documentation site build

## Build Pipeline

```
1. Install dependencies
   ├── npm run install:all
2. Build components
   ├── npm run build:webui
   ├── npm run build:docs
   └── npm run build:desktop
3. Package installer
   └── npm run package
```

## Root Scripts

```json
{
  "scripts": {
    "install:all": "npm install && npm run install:webui && npm run install:docs",
    "install:webui": "cd webui && npm install",
    "install:docs": "cd docs && npm install",
    "build": "npm run build:webui && npm run build:docs && npm run build:desktop",
    "build:webui": "cd webui && npm run build",
    "build:docs": "cd docs && npm run build",
    "build:desktop": "cd desktop && npm run build",
    "package": "cd desktop && npm run package"
  }
}
```

## Desktop Build

### Electron Builder

The desktop app uses electron-builder for packaging:

```json
{
  "build": {
    "appId": "com.alpaca.app",
    "productName": "Alpaca",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "preload.js",
      "public/**/*",
      "docs/**/*"
    ]
  }
}
```

### Build Steps

1. Build web UI
2. Copy to desktop/public
3. Build docs site
4. Copy to desktop/docs
5. Package Electron app

### Build Scripts

- `build-webui.js` — Copies web UI build artifacts
- `build-docs.js` — Copies documentation build

## Web UI Build

Uses Vite for building:

```bash
cd webui
npm run build
```

Output goes to `webui/build/`.

## Documentation Build

Uses Docusaurus:

```bash
cd docs
npm run build
```

Output goes to `docs/build/`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | development/production |
| `ELECTRON_IS_DEV` | Dev mode flag |
| `SKIP_DOCS` | Skip docs build |

## CI/CD Integration

### GitHub Actions

```yaml
name: Build and Release
on: [push]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm run install:all
      - run: npm run build
      - run: npm run package
```

## Troubleshooting

### Build Failures

1. Clear node_modules: `rm -rf node_modules && npm install`
2. Check Node version: `node -v` (requires 18+)
3. Check disk space
4. Review build logs

### Packaging Issues

1. Verify electron-builder config
2. Check included files
3. Test on target platform
