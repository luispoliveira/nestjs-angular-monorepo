# CLAUDE.md

Guidance for Claude Code when working in this NestJS + Angular monorepo template.

---

## Stack Overview

- **Monorepo**: Turborepo + pnpm workspaces ([pnpm-workspace.yaml](pnpm-workspace.yaml), [turbo.json](turbo.json))
- **Backend**: NestJS 11 (TypeScript), microservices via Redis transport
- **Frontend**: Angular 22 (standalone components, signals) + Tailwind CSS v4 + Angular Material
- **Database**: PostgreSQL via Prisma 7 + `PrismaPg` adapter (primary), MongoDB via Mongoose (logs/audit only), Redis (cache/queues)
- **Auth**: `better-auth` + `@thallesp/nestjs-better-auth` — **never** add Passport/JWT
- **Validation**: Zod **v4** + `nestjs-zod` (`createZodDto`, `ZodValidationPipe`, `ZodSerializerInterceptor`) on the backend; the same Zod schemas drive Angular reactive-form validation via `zodValidator()` from `@repo/shared-types`
- **API contract**: REST (`apps/api`'s own controllers) for the frontend's own backend; `apps/web` never talks tRPC — that layer was removed in the Next.js → Angular migration
- **Queue**: `@nestjs/bullmq` (BullMQ) with Redis — **not** legacy Bull v4
- **Logging**: `nestjs-pino` + `nestjs-cls` for correlation IDs
- **Health**: `@nestjs/terminus` (`HealthController` registered globally by `SharedModule`)

Node `>=22`, pnpm `10.33.0` (see [package.json](package.json), [.nvmrc](.nvmrc)).

---

## Workspace Layout

```
apps/
  api/           # NestJS — REST HTTP gateway for the frontend's own backend
  auth/          # NestJS — authentication + session (better-auth)
  notifications/ # NestJS — notification delivery (email via Redis events)
  worker/        # NestJS — BullMQ worker processing email jobs
  cron/          # NestJS — scheduled jobs (@nestjs/schedule), health/metrics HTTP
  web/           # Angular — admin dashboard (standalone components, signals, Angular Material)
packages/
  database/      # Prisma client (PrismaPg adapter), DatabaseModule, seeders
  shared/        # Global NestJS infra: constants, abstracts, guards, interceptors,
                 # filters, publishers, queue, modules, utils, mongo, health,
                 # encryption (AES field crypto + blind index), interfaces
  shared-types/  # Zod v4 schemas + zodValidator() shared between apps/web and the NestJS apps
  mail/          # MailModule with Brevo provider
  testing-utils/ # Test factories, DB truncation, testcontainers e2e setup
  eslint-config/ # Shared ESLint configs
  typescript-config/ # Shared tsconfig bases
```

Internal packages are imported with the `@repo/` prefix:

```typescript
import { DatabaseService } from '@repo/database';
import {
  SharedModule,
  QUEUES,
  SERVICES,
  EVENT_PATTERNS,
  JOB_PATTERNS,
} from '@repo/shared';
import { RoleEnum, paginationSchema } from '@repo/shared-types';
```

---

## Commands

Always use **pnpm** (never npm/yarn). Tasks run through Turborepo.

| Command                               | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `pnpm dev`                            | Run all apps in dev mode                        |
| `pnpm build`                          | Build all apps + packages                       |
| `pnpm lint`                           | Lint all workspaces                             |
| `pnpm check-types`                    | Type-check all workspaces                       |
| `pnpm format`                         | Prettier on `**/*.{ts,tsx,md}`                  |
| `pnpm db:generate`                    | `prisma generate` (runs `@repo/database`)       |
| `pnpm db:migrate`                     | `prisma migrate dev`                            |
| `pnpm db:seed`                        | Seed via `packages/database/src/database-seeder.service.ts` |
| `pnpm docker:up` / `pnpm docker:down` | Local infra (Postgres, Mongo, Redis)            |

Always run `pnpm build` and the relevant tests/lint after code changes before claiming a task is done.

---

## Constants — Never Hardcode

All injection tokens, queue names, and message patterns live in [packages/shared/src/constants/](packages/shared/src/constants/) as `as const` objects. **Always import; never inline.**

| Constant             | Location                | Examples                                          |
| -------------------- | ----------------------- | ------------------------------------------------- |
| `SERVICES`           | `constants/services.ts` | `AUTH`, `NOTIFICATIONS`                           |
| `QUEUES`             | `constants/queues.ts`   | `EMAIL: 'email-queue'`                            |
| `EVENT_PATTERNS`     | `constants/events.ts`   | `USER_CREATED`, `USER_PASSWORD_RESET_REQUESTED`   |
| `MESSAGE_PATTERNS`   | `constants/events.ts`   | `AUTH_AUTHENTICATE`                               |
| `JOB_PATTERNS`       | `constants/jobs.ts`     | `SEND_WELCOME_EMAIL`, `SEND_PASSWORD_RESET_EMAIL` |
| `CLS_CORRELATION_ID` | `constants/cls.ts`      | `'correlationId'`                                 |

---

NestJS conventions: see .claude/rules/nestjs.md (loads when editing apps/{api,auth,notifications,worker,cron}/** or packages/{shared,mail,database}/**).

---

Angular conventions: see .claude/rules/angular.md (loads when editing apps/web/**).

---

Database conventions: see .claude/rules/database.md (loads when editing packages/database/**).

---

## Git Commits

Follow **Gitflow** for branching and **Conventional Commits** for messages. Full rules in [.github/git-commit-instructions.md](.github/git-commit-instructions.md).

### Branching

| Branch              | Base      | Merges into        | Use for                                                |
| ------------------- | --------- | ------------------ | ------------------------------------------------------ |
| `main`              | —         | —                  | Production releases — always tagged, always deployable |
| `develop`           | `main`    | —                  | Integration — latest completed development             |
| `feature/<name>`    | `develop` | `develop`          | New features (one branch per feature)                  |
| `release/<version>` | `develop` | `main` + `develop` | Release prep: bugfixes, version bumps only             |
| `hotfix/<name>`     | `main`    | `main` + `develop` | Urgent production fixes                                |
| `bugfix/<name>`     | `develop` | `develop`          | Non-urgent bug fixes                                   |

- **Never commit directly to `main` or `develop`** — always via PR.
- Use `--no-ff` merges to preserve branch topology.
- Tag every merge to `main` with semver: `v1.0.0`, `v1.2.3`.
- Delete branches after merge.

### Commit messages

- `<type>(<scope>): <imperative summary>` — subject ≤50 chars (hard cap 72), lowercase after colon, no trailing period.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`.
- Scopes map to apps/packages: `auth`, `notifications`, `worker`, `web`, `api`, `database`, `shared`, `shared-types`, `mail`, `ci`, `docker`.
- Breaking changes: append `!` and add a `BREAKING CHANGE:` footer.
- Body explains **why**, not what. Wrap at 72 chars.
- **Do not** include AI attribution lines (no "Generated with...", "Co-authored by Claude/Copilot"), "as requested by...", or first-person pronouns.

---

## OpenSpec Explore

When running OpenSpec explore mode (`/opsx:explore`, `openspec-explore` skill), ask every clarifying question through the **`AskUserQuestion`** tool — never as plain text in the reply. Group related questions (max 4 per call), offer 2–4 concrete options each, and put the recommended option first with `(Recommended)`. Open-ended discussion and findings stay in normal text; only the questions go through the tool.

---

## Corner Cases Memory

**Read [.claude/CORNER_CASES.md](.claude/CORNER_CASES.md) — the index — at the start of every task, then the area file(s) under [.claude/corner-cases/](.claude/corner-cases/) for what you are about to touch.**

It is a living log of non-obvious behaviours, gotchas, and edge cases discovered during development, with one file per area: `zod`, `nestjs`, `auth`, `queues`, `database`, `angular`, `deploy-build` and `testing`. When you discover a new corner case that is not already there, write it in its area file as `## <the gotcha, as a claim>` followed by a short description (symptom → cause → fix → where it is verified), and add its title to the index under the same area. A new area is a new file plus a new index section. Remove or update an entry the moment the code it describes changes.

---

## Source-of-Truth Files

Detailed conventions referenced above live in the Copilot instruction files — read them when you need more depth than this summary:

- [.claude/CORNER_CASES.md](.claude/CORNER_CASES.md) — index of the accumulated corner cases and gotchas (entries live in [.claude/corner-cases/](.claude/corner-cases/))
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — stack overview
- [.github/instructions/nestjs-conventions.instructions.md](.github/instructions/nestjs-conventions.instructions.md)
- [.github/instructions/angular-conventions.instructions.md](.github/instructions/angular-conventions.instructions.md)
- [.github/instructions/database-conventions.instructions.md](.github/instructions/database-conventions.instructions.md)
- [.github/git-commit-instructions.md](.github/git-commit-instructions.md)
- [README.md](README.md), [DEPLOY.md](DEPLOY.md), [DEPLOY-PM2.md](DEPLOY-PM2.md)

When these documents conflict with the summary here, **the source-of-truth file wins** — update this CLAUDE.md to match.

Full pre-split version: .claude/archive/CLAUDE.md.pre-split-2026-10-19.md
