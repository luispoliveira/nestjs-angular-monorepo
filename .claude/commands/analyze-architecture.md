---
name: "Analyze Architecture"
description: "Analyze the codebase architecture — modules, services, patterns, and cross-cutting concerns. Produces a structural overview with ASCII diagrams."
category: Analysis
tags: [architecture, analysis, modules, services]
---

Analyze the architecture of this NestJS + Angular monorepo. Produce a structured report with ASCII diagrams.

**Do not implement anything.** This is a read-only analysis.

**Input**: Optional scope — e.g., `apps/auth`, `packages/shared`, or leave blank for full codebase.

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
- Is `SharedModule.register()` the first import? (it must be)

### 3. Shared Infrastructure

Inspect `packages/shared/src/`:
- What does `SharedModule` provide globally?
- What abstracts exist (`BasePublisher`, `BaseProducer`, `BaseRouter`)?

### 4. Cross-Cutting Concerns

Check for: validation strategy, error handling, logging, auth guard strategy, rate limiting.

### 5. Async Communication

Map all Redis event/message patterns:
```bash
grep -r "EVENT_PATTERNS\|MESSAGE_PATTERNS\|EventPattern\|MessagePattern" apps --include="*.ts" -l
grep -r "JOB_PATTERNS\|@Process\|@Processor" apps --include="*.ts" -l
```

## Output Format

1. **Service Map** — ASCII diagram of all services and communication
2. **Module Inventory** — table: app → modules → role
3. **Constants Inventory** — SERVICES, QUEUES, EVENT_PATTERNS, MESSAGE_PATTERNS, JOB_PATTERNS
4. **Cross-Cutting Concerns** — what's implemented globally vs missing
5. **Observations** — patterns followed, gaps, recommendations

Compare against `ARCHITECTURE_OVERVIEW.md` and offer to update if stale.
