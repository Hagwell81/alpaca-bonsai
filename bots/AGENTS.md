# DOX framework — Bots

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

Bot configurations and integrations for Discord, Slack, and other platforms that connect to the Alpaca local API.

## Ownership

Bot configs, manifests, and runtime scripts live here.

## Local Contracts

- Bots connect to the local API endpoint (`http://localhost:13434/v1`).
- Bot credentials must NOT be committed to git. Use `.env` files.

## Work Guidance

- `README.md` — Overview of available bots and setup instructions
- Each bot should have its own subdirectory with config and source

## Verification

No verification framework exists yet.

## Child DOX Index

This directory is not yet fully organized. Create child AGENTS.md files as bot sub-projects emerge.
