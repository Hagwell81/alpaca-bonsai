# DOX framework — Knowledge Base UI

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

Knowledge base UI for creating document collections, ingesting files/URLs, and performing RAG-grounded chat.

## Ownership

All components in this directory handle knowledge base surfaces: collection management, document ingestion, search, and chat grounding.

## Local Contracts

- Knowledge base state is persisted via electron-store.
- Document ingestion supports files and URLs.
- Search uses the backend RAG pipeline.
- Active collection ID is synced between settings and chat.

## Work Guidance

### Components

- Collection creation/deletion/management
- File and URL ingestion UI
- Document list and search results
- Active collection selector in chat settings

### State Flow

1. User creates collections in knowledge base settings
2. Documents are ingested via desktop IPC to `knowledge-base.js`
3. Active collection is stored in settings
4. Chat prompts include grounding context from the active collection
5. Search results render inline with source citations

## Verification

- `cd webui && npm run check`
- Manual test: create collection, add documents, verify grounded chat responses

## Child DOX Index

This directory has no sub-boundaries requiring child AGENTS.md files.
