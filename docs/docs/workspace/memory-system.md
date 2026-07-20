# Memory System

Persistent and contextual memory for agents.

## Types

- **Conversation Memory**: Chat history within a conversation
- **Workspace Memory**: Facts and context per workspace
- **Global Memory**: Cross-workspace knowledge

## Storage

Stored in SQLite database with vector embeddings for semantic retrieval.

## Configuration

```json
{
  "memory": {
    "enabled": true,
    "maxMessages": 100,
    "summarizeAt": 50,
    "retentionDays": 30
  }
}
```

## API

```bash
curl http://localhost:13434/v1/memory/store \
  -d '{"key": "project_context", "value": "Using React"}'
```
