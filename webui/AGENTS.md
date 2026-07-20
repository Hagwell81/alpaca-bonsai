# DOX framework — WebUI (SvelteKit Frontend)

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

SvelteKit frontend for the Alpaca desktop application. Provides the chat interface, model management, settings, integrations, knowledge base, workspace, and MCP management surfaces.

## Ownership

- `src/routes/` — SvelteKit page routes
- `src/lib/components/` — Svelte components (app-specific + shared UI library)
- `src/lib/stores/` — Svelte runes-based state stores
- `src/lib/services/` — API service layer
- `src/lib/types/` — TypeScript type definitions
- `src/lib/utils/` — Pure utility functions
- `static/` — Static assets

## Local Contracts

- **Svelte runes:** All new state management uses `$state`, `$derived`, `$props`.
- **Stores pattern:** Shared global state lives in `src/lib/stores/`. Feature-local state lives colocated with components.
- **shadcn/ui style:** Shared UI primitives in `src/lib/components/ui/` follow shadcn conventions.
- **IPC only via preload:** Frontend never directly calls Node/Electron APIs. All communication goes through `window.llamaAPI`.
- **DesktopService fallback:** Model management operations (installed models, HuggingFace search/download, delete) use `DesktopService` (in `src/lib/services/desktop.service.ts`) which routes through `window.llamaAPI` IPC when available and falls back to HTTP endpoints on the API gateway (`/v1/desktop/*` on port 13439) when running outside Electron. Components should not gate model management features behind `isElectron` checks — `DesktopService` handles transport selection transparently.
- **ES Modules:** All code uses ES module syntax.
- **TypeScript:** All new code must be typed.

## Work Guidance

### Routes (`src/routes/`)

| Route | Purpose |
|-------|---------|
| `+page.svelte` | Chat home (conversation list + new chat) |
| `chat/[id]/+page.svelte` | Per-chat conversation thread |
| `image/+page.svelte` | Dedicated image generation page (sd.cpp / Bonsai Image 4B) with prompt, steps, CFG, sampler, seed controls and gallery. Auto-downloads missing model files on first visit. |

### App Components (`src/lib/components/app/`)

Organized by feature domain:

- `chat/` — Chat UI (streaming, markdown, attachments, branching, tool calls). See `chat/AGENTS.md`.
- `integrations/` — Integration launcher UI (IDEs, coding agents, tools). See `integrations/AGENTS.md`.
- `knowledgebase/` — Knowledge base collections and search. See `knowledgebase/AGENTS.md`.
- `workspace/` — Workspace file browser and IDE config. See `workspace/AGENTS.md`.
- `mcp/` — MCP server management. See `mcp/AGENTS.md`.
- `models/` — Model browser, download, management. Includes `BonsaiModelsPanel` for bonsai-beach model catalog onboarding.
- `navigation/` — App shell navigation.
- `server/` — Server status and controls.
- `dialogs/` — Shared dialog shells.
- `forms/` — Reusable form components.
- `actions/` — Action buttons and toolbars.
- `badges/` — Status badges.
- `content/` — Content display helpers.
- `misc/` — Uncategorized app components.

### UI Library (`src/lib/components/ui/`)

shadcn-style primitives. See `ui/AGENTS.md`.

**Rule:** UI library components must not import app-specific logic. They are pure presentation primitives.

### Stores, Services, Types, Utils

Follow the same patterns as documented in the parent project's webui/AGENTS.md. Key stores include chat, conversations, models, providers, settings, server, user, mcp, and knowledge base state.

## Verification

- `cd webui && npm run dev` — SvelteKit dev server
- `cd webui && npm run build` — Production build
- `cd webui && npm run check` — TypeScript + svelte-check validation

## Child DOX Index

- `src/lib/components/app/chat/AGENTS.md` — Chat UI components
- `src/lib/components/app/integrations/AGENTS.md` — Integration launcher UI
- `src/lib/components/app/knowledgebase/AGENTS.md` — Knowledge base UI
- `src/lib/components/app/workspace/AGENTS.md` — Workspace file browser UI
- `src/lib/components/app/mcp/AGENTS.md` — MCP server management UI
- `src/lib/components/ui/AGENTS.md` — shadcn-style shared UI primitives
