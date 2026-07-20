# Rate Limiting

Control API usage to prevent abuse and manage resources.

## Overview

Rate limiting protects the API server from excessive requests.

## Configuration

```json
{
  "apiServer": {
    "rateLimit": {
      "enabled": true,
      "windowMs": 60000,
      "maxRequests": 60,
      "skipSuccessfulRequests": false
    }
  }
}
```

## Rate Limit Headers

Responses include rate limit information:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1704067200
```

## Strategies

### Fixed Window

```typescript
const fixedWindow = {
  windowMs: 60000, // 1 minute
  maxRequests: 60
};
```

### Sliding Window

```typescript
const slidingWindow = {
  windowMs: 60000,
  maxRequests: 60,
  sliding: true
};
```

### Per-Client

```typescript
const perClient = {
  keyGenerator: (req) => req.ip,
  windowMs: 60000,
  maxRequests: 60
};
```

## Custom Limits

### By API Key

```json
{
  "apiKeys": [
    {
      "key": "premium-key",
      "rateLimit": {
        "windowMs": 60000,
        "maxRequests": 600
      }
    }
  ]
}
```

### By Endpoint

```json
{
  "endpoints": {
    "/v1/chat/completions": {
      "rateLimit": {
        "windowMs": 60000,
        "maxRequests": 30
      }
    },
    "/v1/models": {
      "rateLimit": {
        "windowMs": 60000,
        "maxRequests": 120
      }
    }
  }
}
```

## Response When Limited

```json
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_exceeded",
    "code": 429
  }
}
```

## Bypassing Rate Limits

For trusted internal services:

```json
{
  "rateLimit": {
    "skip": ["127.0.0.1", "10.0.0.0/8"]
  }
}
```

## Monitoring

Track rate limit events:

```typescript
api.on('rateLimit', (req, info) => {
  console.log(`Rate limited: ${req.ip} - ${info.remaining} remaining`);
});
```
