# DOX framework — UI Component Library

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

Shared UI primitive component library. Follows shadcn/ui conventions: unstyled or minimally-styled headless logic + TailwindCSS class strings.

## Ownership

This directory owns all reusable UI primitives. App-specific components must NOT live here.

## Local Contracts

- **Pure presentation:** No app-specific stores, services, or business logic.
- **Props-forwarding:** Components accept standard props and forward unknown props.
- **Tailwind only:** Styling via Tailwind utility classes. No inline `<style>` blocks.
- **Accessibility:** Keyboard navigation and ARIA attributes required.
- **Svelte runes:** Use `$props` for component props, `$state` for internal state.

## Work Guidance

### Adding or Modifying Primitives

1. Follow shadcn/ui patterns: minimal logic, Tailwind classes, forward props
2. Place in a new subdirectory named after the primitive
3. Ensure the change does not break existing consumers
4. Prefer additive changes (new optional props) over breaking changes

## Verification

- `cd webui && npm run check`
- Visual regression: spot-check key screens after primitive changes

## Child DOX Index

This directory's subdirectories are individual primitive components; no child AGENTS.md files required.
