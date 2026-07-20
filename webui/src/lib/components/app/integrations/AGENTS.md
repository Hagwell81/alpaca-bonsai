# DOX framework — Integration Launcher UI

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

Integration launcher UI for configuring 25+ third-party tools (IDEs, coding agents, RAG tools, automation platforms) to use the Alpaca local API endpoint. Also provides install detection and one-click launch from the Settings panel.

## Ownership

All components in this directory render the integration browser, env config generator, and installation helpers. The settings-tab variant lives at `chat/ChatSettings/ChatSettingsIntegrationsTab.svelte` and is owned by the chat settings subtree.

## Local Contracts

- Integration metadata is served by the desktop main process via IPC (`launch:list-integrations`).
- Env config generation uses `launch:generate-env` and `launch:open-env-folder`.
- Install detection uses `launch:check-installed` (single) and `launch:check-all-installed` (batch).
- One-click launch uses `launch:launch-integration` — checks install status, then either launches the tool in a new terminal with Alpaca env vars preset, or returns an "not installed" error with install instructions.
- Each integration has an icon, description, category, install URL, and an install detector in `desktop/launch-service.js` (`INSTALL_DETECTORS` map).
- The store (`src/lib/stores/launch.svelte.ts`) tracks: `integrations`, `installStatuses` (map), `lastLaunchResult`, `launchingIds` (in-progress set), and exposes helpers `getInstallStatus(id)` and `isLaunching(id)`.

## Work Guidance

### Categories

- Coding Agents (Claude Code, Codex, Cline, Goose, etc.)
- IDEs (VS Code, JetBrains, Zed)
- Chat & RAG (Onyx)
- Automation (n8n)
- Notebooks (marimo)
- Built-in Bots (Discord, Slack)

### Install Detection Methods

Each integration in `INSTALL_DETECTORS` (in `desktop/launch-service.js`) uses one or more of:
- `command` — checks if a CLI command is on PATH (`where` on Windows, `command -v` on Unix)
- `appPath` — checks if a macOS `.app` bundle exists at an absolute path
- `extraCheck` — custom function (e.g. checks for `bots/discord-bot/package.json`)

### Adding New Integrations

1. Add metadata to `desktop/launch-service.js` (in `getIntegrations()` and the `launch()` switch)
2. Add an entry to `INSTALL_DETECTORS` in `desktop/launch-service.js`
3. Add UI card component in this directory (or reuse `ChatSettingsIntegrationsTab.svelte`)
4. Register IPC channels in `desktop/main.js` and `desktop/preload.js` if new channels are needed
5. Update this AGENTS.md

## Verification

- `cd webui && npm run check`
- Manual test: open integrations tab, verify all integrations render, test env generation

## Child DOX Index

This directory has no sub-boundaries requiring child AGENTS.md files.
