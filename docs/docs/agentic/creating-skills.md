# Creating Skills

Skills are reusable capabilities that agents can use.

## What is a Skill?

A skill is a pre-defined capability that:
- Performs a specific task
- Can be shared across agents
- Has defined inputs and outputs
- Can be composed with other skills

## Skill Structure

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  parameters: Parameter[];
  execute: (params: any) => Promise<any>;
}
```

## Creating a Skill

### Step 1: Define the Skill

```typescript
const searchSkill = {
  id: 'web-search',
  name: 'Web Search',
  description: 'Search the web for information',
  parameters: [
    { name: 'query', type: 'string', required: true },
    { name: 'maxResults', type: 'number', default: 5 }
  ],
  async execute({ query, maxResults = 5 }) {
    const results = await webSearch(query, maxResults);
    return results;
  }
};
```

### Step 2: Register the Skill

```typescript
import { SkillRegistry } from './skill-registry';

const registry = new SkillRegistry();
registry.register(searchSkill);
```

### Step 3: Use in Agent

```typescript
const agent = {
  id: 'researcher',
  name: 'Researcher',
  skills: ['web-search', 'summarize', 'citation']
};
```

## Skill Types

### Built-in Skills

Alpaca includes these built-in skills:

| Skill | Description |
|-------|-------------|
| `read-file` | Read file contents |
| `write-file` | Write to files |
| `run-command` | Execute shell commands |
| `web-search` | Search the internet |
| `code-analysis` | Analyze code structure |

### Custom Skills

Create custom skills for your workflow:

```typescript
const customSkill = {
  id: 'deploy-app',
  name: 'Deploy Application',
  parameters: [
    { name: 'environment', type: 'string', default: 'staging' }
  ],
  async execute({ environment }) {
    // Your deployment logic
    await deployToEnvironment(environment);
    return { success: true, url: `https://${environment}.example.com` };
  }
};
```

## Skill Composition

### Chaining Skills

```typescript
const pipeline = [
  { skill: 'web-search', params: { query: 'latest AI news' } },
  { skill: 'summarize', params: { maxLength: 500 } },
  { skill: 'write-file', params: { path: 'summary.md' } }
];

const result = await executePipeline(pipeline);
```

### Conditional Skills

```typescript
const conditionalSkill = {
  ...customSkill,
  condition: (context) => context.hasTests
};
```

## Skill Registry

### Listing Skills

```typescript
const allSkills = registry.list();
const agentSkills = registry.getForAgent('researcher');
```

### Updating Skills

```typescript
registry.update('web-search', {
  ...searchSkill,
  parameters: [
    ...searchSkill.parameters,
    { name: 'language', type: 'string', default: 'en' }
  ]
});
```

## Best Practices

1. **Single responsibility**: Each skill does one thing well
2. **Clear parameters**: Document all inputs and outputs
3. **Error handling**: Return meaningful errors
4. **Idempotency**: Safe to run multiple times
5. **Testing**: Test skills independently

## Example Skills

### Database Query

```typescript
const dbQuery = {
  id: 'db-query',
  name: 'Database Query',
  parameters: [
    { name: 'sql', type: 'string', required: true },
    { name: 'database', type: 'string', default: 'main' }
  ],
  async execute({ sql, database }) {
    const db = await connect(database);
    return db.query(sql);
  }
};
```

### Image Analysis

```typescript
const imageAnalysis = {
  id: 'image-analysis',
  name: 'Analyze Image',
  parameters: [
    { name: 'imagePath', type: 'string', required: true }
  ],
  async execute({ imagePath }) {
    const image = await loadImage(imagePath);
    return analyzeImage(image);
  }
};
```
