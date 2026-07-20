# DOX framework — Workspace UI

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

Workspace UI for selecting a local project folder, browsing its file tree, and generating IDE configuration files that point to the local API endpoint.

## Ownership

All components in this directory handle workspace selection, file tree browsing, and IDE config generation.

## Local Contracts

- Workspace folder path is persisted via electron-store.
- File tree is retrieved recursively via IPC (`workspace:get-file-tree`).
- IDE config generation uses `ide-config-generator.js` in the desktop main process.
- Sandbox mode creates an isolated workspace directory.

## Work Guidance

### Components

- Folder selector (native dialog via IPC)
- File tree browser (recursive, 3 levels deep by default)
- IDE config generator dropdown
- Sandbox toggle and creation UI

### IPC Channels

- `workspace:get-state` — Returns `{ folderPath, isSandbox }`
- `workspace:set-folder` — Sets workspace folder
- `workspace:open-sandbox` — Creates isolated sandbox directory
- `workspace:get-file-tree` — Returns recursive file tree array

## Verification

- `cd webui && npm run check`
- Manual test: select folder, browse tree, generate IDE config, verify sandbox

## Child DOX Index

This directory has no sub-boundaries requiring child AGENTS.md files.
