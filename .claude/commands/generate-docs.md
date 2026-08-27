---
name: "Generate Docs"
description: "Generate or update project documentation — PROJECT_MAP.md, ARCHITECTURE_OVERVIEW.md, ENTRYPOINTS.md, CONVENTIONS.md, DEPENDENCY_GRAPH.md."
category: Documentation
tags: [docs, documentation, generate, update]
---

Generate or update documentation for this NestJS + Angular monorepo.

**Input**: Optional — specify which document(s) to update. Default: all.
- `PROJECT_MAP` — directory inventory
- `ARCHITECTURE_OVERVIEW` — service topology and flows
- `ENTRYPOINTS` — all HTTP, event, and job entry points
- `CONVENTIONS` — coding standards
- `DEPENDENCY_GRAPH` — package and module dependency map

## Process

1. **Scan** — run find/grep to discover current codebase state
2. **Read existing docs** — understand what's already accurate
3. **Identify gaps and staleness** — compare code vs docs
4. **Update** — only change what's wrong, keep what's right

## Quality Standards

- Only document what exists in the code right now
- Include file paths for navigation
- Use tables for inventories, ASCII diagrams for topology
- Remove stale entries from deleted/renamed code
- If uncertain, mark with `<!-- verify -->` — never invent
