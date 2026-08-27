# Monorepo Project Instructions

## Stack Overview

> **Critical rules (highest priority):**
>
> 1. Use `pnpm` exclusively — never npm or yarn.
> 2. Auth via `better-auth` only — never add Passport or JWT.
> 3. Queues via `@nestjs/bullmq` (BullMQ) — never legacy Bull v4 / `@nestjs/bull`.
> 4. Validation via Zod v4 + `nestjs-zod` — use `z.email()`, not `z.string().email()`.
> 5. Never hardcode tokens, queue names, or patterns — always import from `@repo/shared`.

### Tooling

- **Monorepo**: Turborepo + pnpm workspaces (`pnpm-workspace.yaml`)

### Application Layer

- **Backend**: NestJS 11 (TypeScript), microservices via Redis transport
- **Frontend**: Angular 22 (TypeScript, standalone components, signals), Tailwind CSS v4, Angular Material

### Persistence

- **Primary DB**: PostgreSQL via Prisma 7 + PrismaPg adapter
- **Audit/Logging DB**: MongoDB via Mongoose (logs/audit only — no business data)
- **Cache/Queues**: Redis

### Auth & Security

- **Auth**: `better-auth` + `@thallesp/nestjs-better-auth` — **never** add Passport or JWT

### Validation & API

- **Validation**: Zod v4 + `nestjs-zod` (`createZodDto`, `ZodValidationPipe`, `ZodSerializerInterceptor`)
- **API contract**: REST — `apps/api`'s own controllers, same-origin under `/api/` from the frontend

### Infrastructure

- **Queue**: `@nestjs/bullmq` (BullMQ) with Redis — **not** legacy Bull v4 / `@nestjs/bull`
- **Logging**: `nestjs-pino` with correlation IDs via `nestjs-cls`
- **Health**: `@nestjs/terminus` (`HealthController` registered globally by `SharedModule`)

## Package Manager & Commands

- Always use `pnpm` — never npm or yarn
- Run all tasks via Turborepo: `pnpm build`, `pnpm dev`, `pnpm lint`, `pnpm test`
- Database commands: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`
- Infrastructure: `pnpm docker:up` / `pnpm docker:down`

## Workspace Structure

```
apps/
  auth/          # NestJS — authentication + session management (better-auth)
  notifications/ # NestJS — notification delivery (email via Redis events)
  worker/        # NestJS — Bull worker processing email jobs from queue
  web/           # Angular — frontend admin dashboard (standalone components, signals)
packages/
  database/      # Prisma client (PrismaPg adapter), DatabaseModule, DatabaseService, seeders
  shared/        # Global NestJS infrastructure:
                 #   constants/, abstracts/, guards/, interceptors/, filters/,
                 #   publishers/, queue/, modules/, utils/, types/, mongo/, health/
  shared-types/  # Zod v4 schemas + zodValidator() shared between frontend and backend (RoleEnum, paginationSchema, etc.)
  mail/          # MailModule with Brevo provider
  eslint-config/ # Shared ESLint configs
  typescript-config/ # Shared tsconfig bases
```

## Internal Package Imports

All internal packages use the `@repo/` prefix:

```typescript
import { DatabaseModule, DatabaseService } from '@repo/database';
import {
  SharedModule,
  QUEUES,
  SERVICES,
  EVENT_PATTERNS,
  JOB_PATTERNS,
} from '@repo/shared';
import { MailModule } from '@repo/mail';
import { RoleEnum, paginationSchema } from '@repo/shared-types';
```

## Constants — Always Use, Never Hardcode

All tokens, queue names, and patterns live in `@repo/shared/src/constants` as `as const` objects:

| Constant             | Location                | Values                                                  |
| -------------------- | ----------------------- | ------------------------------------------------------- |
| `SERVICES`           | `constants/services.ts` | `AUTH`, `NOTIFICATIONS`                                 |
| `QUEUES`             | `constants/queues.ts`   | `EMAIL: 'email-queue'`                                  |
| `EVENT_PATTERNS`     | `constants/events.ts`   | `USER_CREATED`, `USER_PASSWORD_RESET_REQUESTED`, etc.   |
| `MESSAGE_PATTERNS`   | `constants/events.ts`   | `AUTH_AUTHENTICATE`                                     |
| `JOB_PATTERNS`       | `constants/jobs.ts`     | `SEND_WELCOME_EMAIL`, `SEND_PASSWORD_RESET_EMAIL`, etc. |
| `CLS_CORRELATION_ID` | `constants/cls.ts`      | `'correlationId'`                                       |

**Never hardcode** string tokens, queue names, or patterns inline — always import from `@repo/shared`.

## Zod Version

This project uses **Zod v4**. Use `z.email()` (not `z.string().email()`), `.meta({ id: '...' })` for schema IDs, and other v4 APIs throughout.
