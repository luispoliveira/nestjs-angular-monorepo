---
name: "Dependency Map"
description: "Map all module and package dependencies — internal packages, NestJS module imports, cross-service communication. Detects circular dependencies and rule violations."
category: Analysis
tags: [dependencies, modules, packages, graph]
---

Map all dependencies in this NestJS + Angular monorepo.

**Input**: Optional focus — e.g., `apps/auth`, `@repo/shared`, or leave blank for full map.

## What to Map

1. **Internal package matrix** — which apps/packages use which @repo/* packages
2. **NestJS module tree** — imports graph per app (SharedModule first?)
3. **Cross-service communication** — event emitters and listeners, message senders and handlers
4. **Package exports** — what each @repo/* package exposes vs what's imported directly
5. **Circular dependency detection** — packages importing each other

## Dependency Rules to Check

- Apps must NOT import from other apps (only via Redis)
- @repo/shared CAN import @repo/database (provides DatabaseModule)
- @repo/shared-types must have ZERO internal dependencies
- apps/worker is the ONLY consumer of @repo/mail
- MongoDB used only via @repo/shared/mongo

## Output Format

- Dependency matrix table (apps/packages × @repo/* packages)
- Cross-service communication diagram
- Rule violations list (or "none found")
- Circular dependency list (or "none detected")

Compare against DEPENDENCY_GRAPH.md and offer to update if stale.

**Do not modify code — read only.**
