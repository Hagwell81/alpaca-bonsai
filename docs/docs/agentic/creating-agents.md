# Creating Agents

Learn how to create custom agents in Alpaca.

## What is an Agent?

An agent in Alpaca is an autonomous AI entity that can:
- Process natural language instructions
- Access tools and services
- Maintain conversation context
- Delegate tasks to subagents

## Agent Structure

```typescript
interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: Tool[];
  model: string;
  temperature: number;
}
```

## Creating Your First Agent

### Step 1: Define the Agent

```typescript
const myAgent = {
  id: 'code-reviewer',
  name: 'Code Reviewer',
  description: 'Reviews code for quality and best practices',
  systemPrompt: `You are an expert code reviewer. Analyze code for:
- Security vulnerabilities
- Performance issues
- Maintainability
- Best practices`,
  tools: ['read-file', 'write-file', 'run-test'],
  model: 'llama-3-8b',
  temperature: 0.3
};
```

### Step 2: Register the Agent

```typescript
import { AgentRegistry } from './agent-registry';

const registry = new AgentRegistry();
registry.register(myAgent);
```

### Step 3: Use the Agent

```typescript
const result = await registry.execute('code-reviewer', {
  task: 'Review this function',
  code: 'function add(a, b) { return a + b; }'
});
```

## Agent Types

### Task Agent

Specialized for single tasks:

```typescript
const taskAgent = {
  ...myAgent,
  type: 'task',
  maxSteps: 10
};
```

### Conversation Agent

Maintains ongoing dialogue:

```typescript
const conversationAgent = {
  ...myAgent,
  type: 'conversation',
  memory: true,
  maxContextLength: 4096
};
```

### Orchestrator Agent

Manages other agents:

```typescript
const orchestrator = {
  id: 'project-manager',
  name: 'Project Manager',
  type: 'orchestrator',
  subagents: ['code-reviewer', 'test-writer', 'doc-writer']
};
```

## Advanced Configuration

### Tool Binding

```typescript
const agent = {
  ...myAgent,
  tools: [
    {
      name: 'read-file',
      description: 'Read file contents',
      parameters: {
        path: { type: 'string', required: true }
      }
    }
  ]
};
```

### Memory Management

```typescript
const agent = {
  ...myAgent,
  memory: {
    type: 'conversation',
    maxMessages: 100,
    summarizeAt: 50
  }
};
```

### Error Handling

```typescript
const agent = {
  ...myAgent,
  onError: (error, context) => {
    console.error('Agent error:', error);
    return { retry: true, maxRetries: 3 };
  }
};
```

## Best Practices

1. **Clear system prompts**: Be specific about agent behavior
2. **Minimal tools**: Only provide necessary tools
3. **Error handling**: Always define error recovery
4. **Testing**: Test agents with various inputs
5. **Monitoring**: Log agent actions for debugging

## Examples

### Code Review Agent

```typescript
const codeReviewer = {
  id: 'code-reviewer',
  name: 'Code Reviewer',
  systemPrompt: 'Review code for security, performance, and style.',
  tools: ['read-file', 'run-linter', 'run-security-scan']
};
```

### Documentation Agent

```typescript
const docWriter = {
  id: 'doc-writer',
  name: 'Documentation Writer',
  systemPrompt: 'Write clear, concise documentation.',
  tools: ['read-code', 'write-file', 'search-web']
};
```

### Test Generator

```typescript
const testGenerator = {
  id: 'test-gen',
  name: 'Test Generator',
  systemPrompt: 'Generate comprehensive tests.',
  tools: ['read-code', 'write-file', 'run-test']
};
```
