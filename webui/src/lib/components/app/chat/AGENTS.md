# DOX framework — Chat UI Components

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

Rich chat interface components: streaming message rendering, markdown + syntax highlighting, attachments, branching conversations, tool calls, and MCP integration.

## Ownership

All components in this directory and its subdirectories are owned by the chat feature.

## Local Contracts

- Components must use Svelte runes (`$state`, `$props`, `$derived`).
- Chat state is owned by the chat store (`src/lib/stores/chat.svelte.ts` or equivalent).
- Message rendering uses the markdown pipeline in `src/lib/markdown/`.
- Attachments use `src/lib/utils/attachment-*.ts` helpers.
- Tool-call UIs must use the collapsible summary pattern.
- Branching conversations use branching utilities.

## Work Guidance

### Subdirectory Organization

| Directory | Purpose |
|-----------|---------|
| `ChatAttachments/` | File attachment upload, preview, and removal UI |
| `ChatForm/` | Message input box, send button, stop button |
| `ChatMessages/` | Individual message bubbles, assistant streaming, reasoning display |
| `ChatScreen/` | Main chat viewport, scroll management, welcome state |
| `ChatSettings/` | Settings modal tabs for chat configuration (General, Display, Voice, Sampling, Penalties, Advanced, Import/Export, MCP, Models, Providers, Integrations, Multi-Model, Developer, Experimental) |
| `ChatSidebar/` | Conversation list, search, new-chat button |

### Key Patterns

- **Streaming:** Assistant responses stream token-by-token. Components must handle partial content gracefully.
- **Markdown:** All assistant content is markdown-rendered with syntax highlighting and fenced code blocks.
- **Attachments:** Users can attach images, documents, audio.
- **Tool Calls:** Show collapsible summaries. Expand to show per-tool details.
- **Branching:** Any message can be edited to create a new conversation branch.

### Adding New Chat Components

1. Place in the appropriate subdirectory
2. Import state from the chat store
3. Use shared UI primitives from `src/lib/components/ui/`
4. Update this AGENTS.md if introducing a new pattern

## Verification

- `cd webui && npm run check` — svelte-check must pass
- Manual test: start a chat, verify streaming, attachments, tool calls, branching

## Child DOX Index

This directory's subdirectories are functional groupings; no further child AGENTS.md files required unless a subdirectory grows to 20+ components.
