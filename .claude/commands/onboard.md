---
name: "Onboard"
description: "Guided onboarding for new developers — walks through architecture, key concepts, dev workflow, and a first task. Tailored to experience level."
category: Onboarding
tags: [onboarding, new-developer, tutorial, walkthrough]
---

Welcome to this NestJS + Angular monorepo. Let's get you oriented.

**Input**: Optional context — e.g., `backend`, `frontend`, `fullstack`, or a specific focus like `auth system`.

## Onboarding Path

1. **Project Overview** (5 min) — service topology, apps vs packages, communication patterns
2. **Environment Setup** (10 min) — prerequisites, install, docker, migrate, dev start
3. **Key Concepts** (15 min) — SharedModule, constants, auth flow, validation
4. **Your First Feature** (20 min) — Prisma model → DTO → service → REST → Angular
5. **Development Workflow** — dev, lint, types, build, OpenSpec for structured changes

Ask upfront about experience level (NestJS, Angular, monorepo) to tailor the depth of each section.

## Quick Reference

```bash
pnpm install              # Install all dependencies
pnpm docker:up            # Start Postgres, MongoDB, Redis
pnpm db:migrate           # Run Prisma migrations
pnpm db:seed              # Seed the database
pnpm dev                  # Start all apps in dev mode
pnpm build                # Build all apps
pnpm check-types          # TypeScript check
pnpm lint                 # ESLint check
```

## Key Documents

- `CLAUDE.md` — full conventions (authoritative)
- `ARCHITECTURE_OVERVIEW.md` — service topology
- `ENTRYPOINTS.md` — all API entry points
- `PROJECT_MAP.md` — directory inventory

**Do not implement features during onboarding — explain, read, and demonstrate.**
