# Testing Guide

Testing strategy and practices for Alpaca.

## Testing Levels

### Unit Tests

Test individual functions and components:

```typescript
describe('ChatService', () => {
  it('should send message', async () => {
    const response = await ChatService.sendMessage([
      { role: 'user', content: 'Hello' }
    ]);
    expect(response).toBeDefined();
  });
});
```

### Integration Tests

Test API endpoints and services:

```typescript
describe('API Server', () => {
  it('should return models list', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
```

### E2E Tests

Test complete user flows:

```typescript
describe('Chat Flow', () => {
  it('should complete conversation', async () => {
    await page.goto('http://localhost:13434');
    await page.fill('[data-testid="input"]', 'Hello');
    await page.click('[data-testid="send"]');
    await expect(page.locator('[data-testid="message"]')).toBeVisible();
  });
});
```

## Test Tools

| Tool | Purpose |
|------|---------|
| Jest | Unit testing |
| Playwright | E2E testing |
| Supertest | API testing |
| Vitest | Vite-native testing |

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# With coverage
npm run test:coverage
```

## Test Organization

```
tests/
├── unit/
│   ├── services/
│   ├── stores/
│   └── utils/
├── integration/
│   ├── api/
│   └── database/
└── e2e/
    ├── chat.spec.ts
    └── settings.spec.ts
```

## Mocking

### API Mocking

```typescript
jest.mock('./api-client', () => ({
  sendMessage: jest.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello' } }]
  })
}));
```

### Electron Mocking

```typescript
window.electronAPI = {
  invoke: jest.fn().mockResolvedValue({ success: true })
};
```

## Continuous Integration

### GitHub Actions

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test
      - run: npm run test:e2e
```

## Performance Testing

### Load Testing

```bash
npm run test:load
```

Using the built-in load tester:
```bash
node desktop/test-load.js --requests 100 --concurrent 10
```

## Best Practices

1. **Test behavior, not implementation**
2. **Use meaningful test names**
3. **One assertion per test (ideally)**
4. **Mock external dependencies**
5. **Clean up after tests**
6. **Use data-testid attributes for selectors**

## Coverage Goals

- Services: 90%+
- Components: 80%+
- Utilities: 95%+
- E2E critical paths: 100%
