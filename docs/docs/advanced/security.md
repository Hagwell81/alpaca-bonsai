# Security Guide

This guide covers security best practices for Alpaca.

## API Keys

### Storage

API keys are stored securely using the OS keychain:

- **Windows**: Windows Credential Manager
- **macOS**: Keychain
- **Linux**: Secret Service API / libsecret

### Rotation

Regularly rotate API keys:

1. Go to Settings > API Providers
2. Select the provider
3. Click "Rotate Key"
4. Enter new key

### Scope

Use API keys with minimal permissions:

- **Read-only**: For inference only
- **Write**: For model management
- **Admin**: For full access (avoid if possible)

## Network Security

### Localhost Only

By default, the API server binds to `127.0.0.1` (localhost only):

```json
{
  "host": "127.0.0.1"
}
```

### CORS

Configure CORS for cross-origin requests:

```json
{
  "cors": {
    "enabled": true,
    "origins": ["http://localhost:5173"]
  }
}
```

### Rate Limiting

Enable rate limiting to prevent abuse:

```json
{
  "rateLimit": {
    "enabled": true,
    "requestsPerMinute": 60
  }
}
```

## Model Security

### Download Verification

All downloaded models are verified:

- **SHA256 checksum**: Ensures file integrity
- **Signature verification**: Confirms publisher identity
- **Virus scanning**: Optional with Windows Defender

### Sandboxing

Model inference runs in a sandboxed environment:

- Isolated process
- Limited system access
- Memory boundaries enforced

## Data Privacy

### Local Processing

All inference happens locally:

- No data sent to external servers
- No telemetry without consent
- Model weights never leave your machine

### External Providers

When using external API providers:

- Data is encrypted in transit (TLS 1.3)
- API keys are not logged
- Requests are not cached

## Best Practices

1. **Keep software updated**: Regular updates patch security vulnerabilities
2. **Use strong API keys**: Random 32+ character keys
3. **Monitor access logs**: Check for unauthorized access
4. **Disable unused providers**: Reduce attack surface
5. **Enable firewall**: Block external access to API port

## Incident Response

If you suspect a security breach:

1. Stop the API server
2. Rotate all API keys
3. Check access logs
4. Update to latest version
5. Report to security team
