# Creating Tools

Tools are the building blocks that agents use to interact with the world.

## Tool vs Skill

- **Tool**: Low-level function (e.g., read a file)
- **Skill**: High-level composition (e.g., research and summarize)

## Tool Structure

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: string;
      description: string;
      required?: boolean;
      default?: any;
    }
  };
  execute: (params: any) => Promise<any>;
}
```

## Creating a Tool

### File Reader Tool

```typescript
const readFileTool = {
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: {
    path: {
      type: 'string',
      description: 'Absolute or relative file path',
      required: true
    },
    encoding: {
      type: 'string',
      description: 'File encoding',
      default: 'utf-8'
    }
  },
  async execute({ path, encoding = 'utf-8' }) {
    const fs = require('fs');
    return fs.readFileSync(path, encoding);
  }
};
```

### HTTP Request Tool

```typescript
const httpTool = {
  name: 'http_request',
  description: 'Make HTTP requests',
  parameters: {
    url: { type: 'string', required: true },
    method: { type: 'string', default: 'GET' },
    headers: { type: 'object', default: {} },
    body: { type: 'string' }
  },
  async execute({ url, method, headers, body }) {
    const response = await fetch(url, { method, headers, body });
    return response.json();
  }
};
```

## Tool Registration

### Global Registration

```typescript
import { ToolRegistry } from '@alpaca/tools';

const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(httpTool);
```

### Agent-Specific Tools

```typescript
const agent = {
  id: 'coder',
  tools: ['read_file', 'write_file', 'run_command']
};
```

## Built-in Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `read_file` | Read file | `path`, `encoding` |
| `write_file` | Write file | `path`, `content` |
| `list_dir` | List directory | `path` |
| `run_command` | Run shell command | `command`, `cwd` |
| `search_web` | Web search | `query`, `max_results` |
| `read_url` | Read URL content | `url` |

## Tool Execution

### Direct Execution

```typescript
const result = await registry.execute('read_file', {
  path: './README.md'
});
```

### Agent Execution

```typescript
const agent = {
  tools: ['read_file', 'write_file']
};

// Agent decides which tool to use
const response = await agent.run('Create a file named test.txt');
```

## Error Handling

```typescript
const tool = {
  ...readFileTool,
  async execute(params) {
    try {
      return await originalExecute(params);
    } catch (error) {
      return {
        error: error.message,
        suggestion: 'Check if file exists and you have read permissions'
      };
    }
  }
};
```

## Validation

### Schema Validation

```typescript
const tool = {
  name: 'calculate',
  parameters: {
    expression: {
      type: 'string',
      required: true,
      validate: (value) => {
        // Ensure no malicious code
        if (value.includes(';')) {
          throw new Error('Invalid expression');
        }
        return true;
      }
    }
  }
};
```

## Testing Tools

```typescript
describe('read_file tool', () => {
  it('reads existing file', async () => {
    const result = await readFileTool.execute({
      path: './test.txt'
    });
    expect(result).toContain('test content');
  });

  it('handles missing file', async () => {
    const result = await readFileTool.execute({
      path: './missing.txt'
    });
    expect(result.error).toBeDefined();
  });
});
```
