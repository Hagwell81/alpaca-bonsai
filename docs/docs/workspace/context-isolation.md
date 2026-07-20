# Context Isolation

How workspace context isolation works.

## Overview

Each workspace maintains isolated context to prevent cross-contamination between projects.

## Isolation Levels

- **File System**: Separate file trees per workspace
- **Memory**: Isolated memory stores
- **Models**: Per-workspace model preferences
- **API Keys**: Per-workspace key management

## Configuration

```json
{
  "workspace": {
    "isolation": {
      "files": true,
      "memory": true,
      "models": false,
      "keys": true
    }
  }
}
```

## Switching Workspaces

Use the workspace switcher in the UI or API:

```bash
curl -X POST http://localhost:13434/v1/workspace/switch \
  -d '{"workspace": "my-project"}'
```
