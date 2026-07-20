# DOX framework — Documentation Site

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
6. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

## Update After Editing

Every meaningful change requires a DOX pass before the task is done. Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

## Purpose

Docusaurus documentation site covering installation, usage, development guides, API reference, and troubleshooting for Alpaca.

## Ownership

- `docs/` — Markdown/MDX documentation pages
- `src/` — Custom React components and theme overrides
- `static/` — Static assets (images, OpenAPI JSON, API explorer HTML)
- `docusaurus.config.js` — Site configuration

## Local Contracts

- Docs are built by `npm run build:docs` and copied into the desktop bundle by `desktop/build-docs.js`.
- The site includes an interactive API Explorer page backed by `static/openapi.json`.
- All user-facing references use `Alpaca`.

## Work Guidance

### Adding New Documentation

1. Create `.md` or `.mdx` files in `docs/`
2. Add to sidebar navigation in `docusaurus.config.js`
3. Use frontmatter for title, description, sidebar position

### API Documentation

- OpenAPI spec is served at `static/openapi.json`
- API Explorer is at `static/api-explorer.html`
- `docs/api/rest-api.md` — REST API reference covering both the API gateway (port 13439) and llama-server (port 13434), including OpenAI-compatible endpoints, Anthropic-compatible `/v1/messages` (Claude Code), Ollama-compatible `/api/*` endpoints, image generation, and `/v1/desktop/*` model management
- `docs/api/tool-calling.md` — Tool calling (function calling) protocol: the OpenAI-compatible `tools` field, streaming tool-call delta accumulation, the built-in TUI tools (`read_file`, `list_dir`, `web_fetch`), tool calling across all three protocol families (OpenAI / Anthropic / Ollama), and the `/v1/desktop/*` model-management HTTP endpoints
- `docs/api/ipc-channels.md` — Complete `window.llamaAPI` IPC bridge reference (server, models, HuggingFace, bonsai catalog, voice, image, KB, workspace, TUI, launch service, IDE, providers, VRAM, diagnostics, user auth, web search, jCodeMunch, plus `migrationAPI` and `secretVaultAPI`)

### Feature Documentation

- `docs/features.md` — Comprehensive feature list including the Bonsai model catalog, image generation (sd.cpp / Bonsai Image 4B), tool calling, Terminal UI, and the full API endpoint table
- `docs/user-guide/features-overview.md` — User-facing feature overview with sections for image generation, tool calling, TUI, and the Bonsai model catalog

## Verification

- `cd docs && npm run start` — Dev server
- `cd docs && npm run build` — Static build (must succeed)

## Child DOX Index

This directory has no durable sub-boundaries requiring child AGENTS.md files.
