# API Authentication

Secure your API with authentication and access control.

## Overview

The Alpaca API supports multiple authentication methods.

## API Key Authentication

### Using API Keys

```bash
curl http://localhost:13434/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Configuration

```json
{
  "apiServer": {
    "auth": {
      "enabled": true,
      "apiKeys": [
        {
          "key": "your-secret-key",
          "name": "Development",
      "permissions": ["read", "write"]
        }
      ]
    }
  }
}
```

## No Authentication (Local Use)

For local development, authentication can be disabled:

```json
{
  "apiServer": {
    "auth": {
      "enabled": false
    }
  }
}
```

**Warning**: Only disable auth for local development!

## Rate Limiting

Authentication enables rate limiting per API key:

```json
{
  "apiServer": {
    "rateLimit": {
      "enabled": true,
      "requestsPerMinute": 60,
      "requestsPerHour": 1000
    }
  }
}
```

## Best Practices

1. Use strong, random API keys
2. Rotate keys regularly
3. Limit permissions per key
4. Monitor key usage
5. Revoke unused keys
