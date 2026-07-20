# API Key Management

Manage API keys for all providers securely.

## Overview

Alpaca securely stores API keys using your operating system's keychain.

## Storage

### Windows
- Uses Windows Credential Manager
- Keys encrypted with DPAPI
- Accessible only by your user account

### macOS
- Uses Keychain Access
- System-level encryption
- Biometric protection available

### Linux
- Uses Secret Service API (libsecret)
- D-Bus based key storage
- Compatible with GNOME Keyring, KWallet

## Adding API Keys

### Via Settings UI

1. Open Alpaca
2. Go to Settings (Ctrl+,)
3. Select "API Providers"
4. Choose provider
5. Enter API key
6. Click "Save"

### Via Configuration File

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-..."
    }
  }
}
```

**Note**: Keys in config files are stored as plaintext. Use the UI for secure storage.

## Key Rotation

### Manual Rotation

1. Generate new key from provider dashboard
2. Update in Alpaca Settings
3. Revoke old key from provider

### Best Practices

- Rotate keys every 90 days
- Use different keys for different environments
- Never commit keys to version control
- Monitor key usage for anomalies

## Key Validation

The app validates keys on save:

```typescript
async validateKey(provider, key) {
  try {
    await testRequest(provider, key);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
```

## Multiple Keys

You can configure multiple keys per provider:

```json
{
  "providers": {
    "openai": {
      "keys": [
        { "name": "Primary", "key": "sk-..." },
        { "name": "Backup", "key": "sk-..." }
      ]
    }
  }
}
```

## Security Checklist

- [ ] Keys stored in OS keychain
- [ ] Regular rotation schedule
- [ ] No keys in config files (use keychain)
- [ ] Revoke unused keys
- [ ] Monitor API usage
- [ ] Use least-privilege keys
