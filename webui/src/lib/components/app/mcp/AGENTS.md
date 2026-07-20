# DOX framework — MCP UI Components

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

Model Context Protocol (MCP) server management UI. Allows users to configure, enable/disable, and browse tools/resources from MCP servers.

## Ownership

All components in this directory handle MCP UI surfaces.

## Local Contracts

- MCP server configuration is persisted via electron-store.
- Tool invocation results render inline in the chat.
- Resource browsing uses a tree view.

## Work Guidance

### Components

- MCP server card with enable/disable toggle and config editor
- Resource browser tree
- Tool list with invocation UI

## Verification

- `cd webui && npm run check`
- Manual test: add an MCP server, verify tools appear in chat

## Child DOX Index

This directory has no sub-boundaries requiring child AGENTS.md files.
