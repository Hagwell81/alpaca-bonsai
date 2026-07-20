# File Operations

Working with files in workspaces.

## Supported Operations

- Read files
- Write files
- List directories
- Search files
- Watch files for changes

## Security

File operations are sandboxed to the workspace directory.

## API

```bash
curl http://localhost:13434/v1/files/read \
  -d '{"path": "src/main.js"}'
```

## Permissions

Granular permissions per operation:
- Read-only
- Read-write
- Execute
