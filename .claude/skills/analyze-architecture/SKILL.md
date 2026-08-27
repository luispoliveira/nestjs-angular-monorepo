---
name: analyze-architecture
description: Analyze the codebase architecture — modules, services, patterns, and cross-cutting concerns. Produces a clear structural overview with ASCII diagrams.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Analyze the architecture of this NestJS + Angular monorepo. Produce a structured report with ASCII diagrams.

**Do not implement anything.** This is a read-only analysis skill.

---

## What to Analyze

### 1. Service Topology

Map all apps and their roles:
- Which apps exist in `apps/`?
- What is each app's primary responsibility?
- What ports do they run on?
- How do they communicate (HTTP, Redis, Bull)?

### 2. Module Structure (per NestJS app)

For each NestJS app:
```bash
find apps/<name>/src -name '*.module.ts' | sort
```

- What modules are imported?
- What is global vs local?
- Is `SharedModule.register()` the first import? (it must be)

### 3. Shared Infrastructure

Inspect `packages/shared/src/`:
- What does `SharedModule` provide globally?
- What abstracts exist (`BasePublisher`, `BaseProducer`, `BaseRouter`)?
- What utilities are available (`BootstrapUtil`, `MicroserviceUtil`, `PaginatedUtil`)?

### 4. Cross-Cutting Concerns

Check for:
- Validation strategy (Zod v4 + nestjs-zod?)
- Error handling (`AllExceptionFilter`?)
- Logging (`nestjs-pino` + correlation IDs?)
- Auth guard strategy (`AuthGuard` as `APP_GUARD`?)
- Rate limiting (`ThrottlerModule`?)

### 5. Data Layer

Check `packages/database/`:
- Prisma schema models
- `auth.prisma` (managed by better-auth)
- MongoDB schemas (logs only?)
- Seeder structure

### 6. Async Communication

Map all Redis event/message patterns:
```bash
grep -r "EVENT_PATTERNS\|MESSAGE_PATTERNS\|EventPattern\|MessagePattern" apps --include="*.ts" -l
```

Map all Bull queue jobs:
```bash
grep -r "JOB_PATTERNS\|@Process\|@Processor" apps --include="*.ts" -l
```

---

## Output Format

Produce a report with:

1. **Service Map** — ASCII diagram of all services and communication
2. **Module Inventory** — table: app → modules → role
3. **Constants Inventory** — SERVICES, QUEUES, EVENT_PATTERNS, MESSAGE_PATTERNS, JOB_PATTERNS values
4. **Cross-Cutting Concerns** — what's implemented globally vs missing
5. **Data Layer Summary** — DB models, schemas, seeders
6. **Async Flow** — event → queue → consumer chain
7. **Observations** — patterns followed, gaps, recommendations

---

## Reference Documents

- `ARCHITECTURE_OVERVIEW.md` — existing architecture doc (compare against it)
- `DEPENDENCY_GRAPH.md` — module dependency map
- `CLAUDE.md` — stack conventions

---

## Guardrails

- Never modify files — read only
- If `ARCHITECTURE_OVERVIEW.md` is stale, offer to update it
- Flag any deviations from `CLAUDE.md` conventions
- Note any modules missing `SharedModule.register()` as first import
