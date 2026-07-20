# Spec-Driven Development

Use specifications to drive agent behavior and code generation.

## What is Spec-Driven Development?

Spec-driven development (SDD) uses formal specifications to:
- Define requirements precisely
- Generate implementation automatically
- Verify correctness against spec
- Guide agent behavior

## Specification Language

### Basic Spec

```yaml
spec:
  name: User Authentication
  version: 1.0.0
  
  requirements:
    - id: AUTH-001
      description: Users can login with username and password
      acceptance:
        - Given valid credentials, return auth token
        - Given invalid credentials, return 401 error
    
    - id: AUTH-002
      description: Passwords must be hashed
      acceptance:
        - Password stored as bcrypt hash
        - Salt rounds >= 12
```

## Creating Specs

### From Natural Language

```typescript
const spec = await generateSpec(`
Create a user authentication system with:
- Username/password login
- Password hashing with bcrypt
- JWT token generation
- Token refresh mechanism
`);
```

### From Code

```typescript
const spec = extractSpecFromCode(`
function authenticate(username, password) {
  // SPEC: AUTH-001
  // Given valid credentials, return auth token
  const user = db.findUser(username);
  if (!user) return { error: 'Invalid credentials' };
  
  // SPEC: AUTH-002
  // Password stored as bcrypt hash
  const valid = bcrypt.compare(password, user.hash);
  if (!valid) return { error: 'Invalid credentials' };
  
  return { token: jwt.sign({ userId: user.id }) };
}
`);
```

## Using Specs with Agents

### Spec-Driven Agent

```typescript
const agent = {
  id: 'spec-implementer',
  systemPrompt: `You are a spec-driven developer.
Follow these specifications precisely:
{{spec}}

Generate code that satisfies all requirements.`,
  tools: ['read-spec', 'generate-code', 'run-tests']
};
```

### Verification

```typescript
const verify = async (spec, implementation) => {
  for (const req of spec.requirements) {
    const test = generateTest(req);
    const result = await runTest(test, implementation);
    
    if (!result.passed) {
      return {
        valid: false,
        failed: req.id,
        details: result.error
      };
    }
  }
  
  return { valid: true };
};
```

## Spec Repository

### Storage

```typescript
const repo = {
  async save(spec) {
    await db.specs.insert(spec);
  },
  
  async load(id) {
    return db.specs.findOne({ id });
  },
  
  async query(filters) {
    return db.specs.find(filters);
  }
};
```

### Versioning

```typescript
const versionedSpec = {
  id: 'auth-spec',
  versions: [
    { version: '1.0.0', date: '2026-01-01', spec: {...} },
    { version: '1.1.0', date: '2026-02-01', spec: {...} }
  ]
};
```

## Integration

### With CI/CD

```yaml
# .github/workflows/spec-verify.yml
name: Verify Specs
on: [push]
jobs:
  verify:
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx spec-verify --specs ./specs
```

### With Code Generation

```typescript
const generateFromSpec = async (spec) => {
  const code = await agent.run(`
    Implement this specification:
    ${JSON.stringify(spec)}
  `);
  
  const verified = await verify(spec, code);
  return verified.valid ? code : null;
};
```

## Best Practices

1. **Atomic requirements**: Each requirement should be testable independently
2. **Clear acceptance criteria**: Define what "done" means
3. **Version specs**: Track changes to specifications
4. **Link to code**: Reference spec IDs in code comments
5. **Automate verification**: Run spec checks in CI/CD

## Example: API Spec

```yaml
spec:
  name: REST API
  base: /api/v1
  
  endpoints:
    - path: /users
      methods: [GET, POST]
      auth: required
      
    - path: /users/:id
      methods: [GET, PUT, DELETE]
      auth: required
      
  responses:
    success:
      status: 200
      schema:
        type: object
        properties:
          data: { type: object }
          meta: { type: object }
    
    error:
      status: 400
      schema:
        type: object
        properties:
          error: { type: string }
          code: { type: string }
```
