# Project Structure

Understanding the Alpaca codebase layout.

## Directory Layout

```
alpaca/
├── desktop/          # Electron application
│   ├── main.js       # Main process
│   ├── preload.js    # Preload script
│   └── public/       # Web UI build
├── webui/            # SvelteKit frontend
│   ├── src/          # Source code
│   └── build/        # Build output
├── docs/             # Docusaurus documentation
│   ├── docs/         # Markdown content
│   └── build/        # Build output
├── models/           # Downloaded models
└── tests/            # Test suites
```

## Key Files

| File | Purpose |
|------|---------|
| `desktop/main.js` | Electron main process |
| `webui/src/lib/services/chat.service.ts` | Chat API client |
| `docs/sidebars.js` | Documentation navigation |
| `package.json` | Root build orchestration |

## Module Organization

- Services: API communication
- Stores: State management
- Components: UI elements
- Utils: Helper functions
