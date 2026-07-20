# Deployment

This guide covers deploying Alpaca in various environments.

## Desktop Application

### Windows

The Windows installer (`Alpaca-Setup.exe`) can be deployed via:

- **Manual installation**: Run the installer and follow prompts
- **Silent installation**: `Alpaca-Setup.exe /S`
- **Group Policy**: Deploy via MSI or EXE through Active Directory

### macOS

Coming soon.

### Linux

Coming soon.

## Documentation Site

### Static Hosting

The documentation site is a static build that can be hosted anywhere:

```bash
cd docs
npm run build
# Deploy build/ directory to your hosting provider
```

### GitHub Pages

```bash
cd docs
npm run deploy
```

### Netlify / Vercel

Connect your Git repository and set the build command to:

```bash
cd docs && npm run build
```

With publish directory set to `docs/build`.

## API Server

### Docker (Coming Soon)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
EXPOSE 13434
CMD ["node", "desktop/api-server.js"]
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALPACA_PORT` | API server port | `13434` |
| `ALPACA_HOST` | API server host | `127.0.0.1` |
| `ALPACA_MODEL_PATH` | Default model path | - |
