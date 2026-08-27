# DEPENDENCY_GRAPH.md — NestJS + Angular Monorepo

Package dependencies, module imports, and cross-service communication map.
Arrows indicate "depends on" direction.

See also: [PROJECT_MAP.md](PROJECT_MAP.md) | [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) | [ENTRYPOINTS.md](ENTRYPOINTS.md)

---

## Internal Package Dependency Graph

```text
apps/auth ──────────────────────────────────────────────────────────┐
  │                                                                  │
  ├─→ @repo/shared         (SharedModule, utils, guards, constants)  │
  ├─→ @repo/database       (DatabaseService, Prisma models)          │
  ├─→ @repo/shared-types   (RoleEnum, EnvironmentEnum)              │
  └─→ better-auth          (auth engine)                             │
       └─→ @better-auth/prisma-adapter                              │
                                                                      │
apps/api ────────────────────────────────────────────────────────────┤
  │                                                                  │
  ├─→ @repo/shared         (SharedModule, MicroserviceUtil,          │
  │                          MicroserviceAuthGuard)                   │
  ├─→ @repo/database       (DatabaseService)                         │
  └─→ @repo/shared-types   (schemas, RoleEnum)                       │
      Plain REST controllers only — no tRPC (removed in the          │
      Next.js → Angular migration).                                  │
                                                                      │
apps/cron ───────────────────────────────────────────────────────────┤
  │                                                                  │
  ├─→ @repo/shared         (SharedModule, MetricsModule)             │
  ├─→ @repo/shared-types   (env schema)                              │
  └─→ @nestjs/schedule     (ScheduleModule.forRoot, @Cron)           │
                                                                      │
apps/notifications ──────────────────────────────────────────────────┤
  │                                                                  │
  ├─→ @repo/shared         (SharedModule, QueueModule, EmailProducer)│
  └─→ @repo/shared-types   (schemas)                                 │
                                                                      │
apps/worker ─────────────────────────────────────────────────────────┤
  │                                                                  │
  ├─→ @repo/shared         (SharedModule, QueueModule, JOB_PATTERNS) │
  └─→ @repo/mail           (MailModule, email sending)               │
                                                                      │
apps/web ────────────────────────────────────────────────────────────┘
  │
  ├─→ @repo/shared-types   (Zod schemas for forms + response parsing,
  │                          RoleEnum, zodValidator())
  ├─→ better-auth/client   (authClient, session atom bridged by
  │                          SessionService)
  └─→ @tanstack/angular-query-experimental (injectQuery/injectMutation
                             against apps/api's REST endpoints)

  No @repo/trpc — that package was removed in the Next.js → Angular
  migration; apps/web calls apps/api's REST endpoints directly.
```

---

## NestJS Module Imports per App

### `apps/api`

| Module                                                                      | Source                            |
| --------------------------------------------------------------------------- | --------------------------------- |
| `SharedModule.register({ metrics: { appName: 'api' }, throttlerRedisUrl })` | `@repo/shared`                    |
| `ClientsModule` with `registerAuthService()`                                | `@repo/shared` (MicroserviceUtil) |
| `APP_GUARD: MicroserviceAuthGuard`                                          | `@repo/shared`                    |

### `apps/cron`

| Module                                                       | Source              |
| -------------------------------------------------------------| -------------------- |
| `SharedModule.register({ validate: cronEnvSchema.parse, metrics: { appName: 'cron' } })` | `@repo/shared` |
| `ScheduleModule.forRoot()`                                    | `@nestjs/schedule`   |

No `ClientsModule` and no `app.connectMicroservice()` call — `apps/cron` never
listens on or sends to Redis as a microservice.

### `apps/auth`

| Module                                                | Source                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| `SharedModule.register({})`                           | `@repo/shared`                               |
| `ClientsModule` with `registerNotificationsService()` | `@repo/shared` (MicroserviceUtil)            |
| `AuthModule.forRootAsync(...)`                        | `@thallesp/nestjs-better-auth`               |
| `DatabaseModule`                                      | `@repo/database` (within AuthModule factory) |
| `ConfigModule`                                        | `@nestjs/config` (within AuthModule factory) |

### `apps/notifications`

| Module                                                             | Source         |
| ------------------------------------------------------------------ | -------------- |
| `SharedModule.register({ metrics: { appName: 'notifications' } })` | `@repo/shared` |
| `QueueModule.registerQueues([QUEUES.EMAIL])`                       | `@repo/shared` |

### `apps/worker`

| Module                                                      | Source                       |
| ----------------------------------------------------------- | ---------------------------- |
| `SharedModule.register({ metrics: { appName: 'worker' } })` | `@repo/shared`               |
| `QueueModule.registerQueues([QUEUES.EMAIL])`                | `@repo/shared`               |
| `MailModule.forRootAsync({ provider: 'brevo', ... })`       | `@repo/mail`                 |
| `DlqModule`                                                 | local `apps/worker/src/dlq/` |

#### `DlqModule`

| Module                                       | Source         |
| -------------------------------------------- | -------------- |
| `QueueModule.registerQueues([QUEUES.EMAIL])` | `@repo/shared` |

---

## Key Third-Party Dependencies

### Backend (NestJS apps + shared/mail packages)

| Package                             | Version                    | Role                             |
| ----------------------------------- | -------------------------- | -------------------------------- |
| `@nestjs/common`                    | `^11`                      | Core NestJS                      |
| `@nestjs/microservices`             | `^11`                      | Redis transport                  |
| `@nestjs/bullmq`                    | `^11`                      | BullMQ integration (never legacy `bull` / `@nestjs/bull`) |
| `@nestjs/terminus`                  | `^11`                      | Health checks                    |
| `@nestjs/schedule`                  | `^6` (apps/cron only)      | Cron jobs — `ScheduleModule.forRoot()`, `@Cron()` |
| `@nestjs/throttler`                 | via shared                 | Rate limiting                    |
| `@nest-lab/throttler-storage-redis` | via shared                 | Redis throttler storage          |
| `@willsoto/nestjs-prometheus`       | via shared                 | Prometheus metrics               |
| `better-auth`                       | `^1.6.23`                  | Auth framework                   |
| `@thallesp/nestjs-better-auth`      | via auth                   | NestJS adapter for better-auth   |
| `@better-auth/prisma-adapter`       | via auth                   | Prisma adapter for better-auth   |
| `nestjs-zod`                        | via shared                 | Zod validation pipe + serializer |
| `nestjs-pino`                       | via shared                 | Structured logging               |
| `nestjs-cls`                        | via shared                 | Continuation-local storage       |
| `@prisma/client`                    | `^7`                       | Database ORM                     |
| `@prisma/adapter-pg`                | `^7`                       | PrismaPg driver adapter          |
| `@nestjs/mongoose`                  | via shared                 | MongoDB / Mongoose               |
| `bullmq`                            | via `@nestjs/bullmq`       | BullMQ client                    |
| `@sentry/nestjs`                    | via shared                 | Error tracking (optional — enabled by setting `SENTRY_DSN`) |
| `zod`                               | `~4.4.3` (pinned globally) | Validation schemas               |

No `nestjs-trpc-v2` — the tRPC gateway was removed from `apps/api` in the
Next.js → Angular migration (`openspec/changes/archive/2026-08-26-migrate-web-to-angular`).

**Dev / test dependencies** (apps + `packages/shared`, `packages/mail`, `packages/database`):

| Package           | Role                                                      |
| ----------------- | --------------------------------------------------------- |
| `jest`            | Test runner                                               |
| `ts-jest`         | TypeScript transform for Jest — uses `tsconfig.test.json` |
| `@nestjs/testing` | `Test.createTestingModule` for unit and integration tests |
| `@types/jest`     | TypeScript types for Jest globals                         |

### Frontend (`apps/web`) — Angular 22

| Package                                | Version    | Role                                                          |
| ---------------------------------------- | ---------- | -------------------------------------------------------------- |
| `@angular/core`                         | `^22.1.0`  | Standalone components + signals                               |
| `@angular/router`                       | `^22.1.0`  | Functional guards (`CanActivateFn`), lazy-loaded routes        |
| `@angular/forms`                        | `^22.1.0`  | Reactive forms                                                 |
| `@angular/material`                     | `^22.1.4`  | Dialogs, tables, menus, form fields, snackbars                 |
| `@angular/cdk`                          | `^22.1.4`  | Component Dev Kit (backs Angular Material)                     |
| `@tanstack/angular-query-experimental`  | `^5.102.5` | `injectQuery`/`injectMutation` — data fetching, 60 s `staleTime` |
| `better-auth`                           | `^1.6.23`  | Vanilla auth client (no Angular-specific package), plugins `twoFactorClient()` + `adminClient()` |
| `tailwindcss`                           | `^4`       | Utility CSS — owns layout; Angular Material owns component surfaces |
| `zod`                                   | `~4.4.3`   | Client-side validation, shared with the backend via `@repo/shared-types` |
| `rxjs`                                  | via Angular| Reactive primitives (Angular internals)                        |

No `next`, no React, no tRPC client, no React Hook Form — all replaced by
Angular equivalents in the Next.js → Angular migration.

---

## `packages/shared` Internal Structure

```
@repo/shared
├── abstracts/
│   ├── BaseProducer         ← extend for new BullMQ producers
│   ├── BasePublisher        ← extend for new Redis event publishers
│   └── BaseDlqService       ← extend for new DLQ service implementations
├── config/
│   └── baseEnvSchema        ← shared env validation base, extended per-app
├── constants/               ← SERVICES, QUEUES, EVENT_PATTERNS, MESSAGE_PATTERNS,
│                               JOB_PATTERNS, CLS_CORRELATION_ID, THROTTLE_TIERS
├── decorators/
│   ├── @Public()            ← bypasses APP_GUARD
│   ├── @CurrentUser()       ← extracts request.user
│   └── @RateLimit(tier)     ← CustomThrottlerGuard + Throttle config
├── encryption/
│   ├── EncryptionService    ← AES field crypto
│   └── encryption.util      ← blind index helper
├── enums/                   ← barrel re-export point (currently empty)
├── filters/
│   └── AllExceptionFilter   ← @Catch() — normalised errors, Sentry capture
├── guards/
│   ├── CustomThrottlerGuard ← user.id > IP key strategy
│   └── MicroserviceAuthGuard← validates token via AUTH_SERVICE Redis call
├── health/
│   └── HealthController     ← GET /health/live, GET /health/ready
├── interceptors/
│   ├── LoggingInterceptor   ← HTTP req/res → MongoDB Log
│   └── CorrelationInterceptor← propagates correlationId into CLS for RPC
├── interfaces/
│   └── BaseService<T>       ← findOneById(id): Promise<T>
├── logging/
│   └── pino.config.ts       ← pino logger config (pretty dev / JSON prod)
├── metrics/
│   ├── MetricsModule        ← Prometheus with per-app labels
│   ├── MetricsController    ← GET /metrics (MetricsAuthGuard protected)
│   └── HttpMetricsInterceptor← duration histogram per route
├── modules/
│   └── SharedModule         ← @Global() dynamic module
├── mongo/
│   ├── MongoModule          ← @Global() Mongoose module
│   ├── MongoService         ← createLog, updateLog, createEmailLog, updateEmailLog
│   ├── schema/log.schema.ts ← HTTP request/response log
│   └── schema/email-log.schema.ts ← sent email record
├── publishers/
│   └── NotificationsPublisher← emit all USER_* events to notifications service
├── queue/
│   ├── QueueModule          ← BullMQ root + registerQueues (main + DLQ)
│   ├── producers/EmailProducer← send all email job types
│   └── input/               ← Zod DTOs for each job type
├── types/
│   ├── PaginatedType        ← generic paginated response shape
│   └── PagedMetaType        ← pagination metadata
└── utils/
    ├── BootstrapUtil        ← app setup (helmet, versioning, swagger, cors, cookie-parser)
    ├── MicroserviceUtil     ← registerAuthService, registerNotificationsService
    ├── PaginatedUtil        ← getPaginatedResponse(items, total, skip, take)
    ├── ContextUtil          ← extractToken from header/cookie
    ├── SanitizeUtil         ← redacts sensitive keys (password, token, etc.)
    ├── SentryUtil           ← init(appName), captureException(error, context)
    └── LoggerUtil           ← logger helper
```

No `trpc/` sub-directory — `packages/shared`'s tRPC middlewares (`TrpcModule`,
`AppContext`, `BaseRouter`, `LoggingTrpcMiddleware`, `AuthTrpcMiddleware`) were
removed along with `apps/api`'s tRPC gateway in the Next.js → Angular migration.

---

## NestJS Module Dependencies (per app)

### `apps/auth` Module Graph

```text
AppModule
├─ SharedModule.register()
│   ├─ ConfigModule
│   ├─ DatabaseModule ──→ @repo/database
│   ├─ TerminusModule
│   ├─ MongoModule
│   ├─ LoggerModule (pino)
│   ├─ ThrottlerModule
│   ├─ ClsModule
│   └─ MetricsModule
│
├─ ClientsModule (NOTIFICATIONS_SERVICE client)
│
└─ AuthModule (@thallesp/nestjs-better-auth)
    ├─ DatabaseModule (Prisma adapter)
    └─ ConfigModule
```

### `apps/api` Module Graph

```text
AppModule
├─ SharedModule.register()
│   └─ (same as above)
│
├─ ClientsModule (AUTH_SERVICE client)
│
├─ APP_GUARD: MicroserviceAuthGuard
│
└─ AppController (@Controller(), plain REST — no tRPC)
```

### `apps/cron` Module Graph

```text
AppModule
├─ SharedModule.register({ validate: cronEnvSchema.parse, metrics: { appName: 'cron' } })
│   └─ (same as apps/auth above)
│
└─ ScheduleModule.forRoot()      ← @nestjs/schedule
    └─ ExampleCronService (@Cron(CronExpression.EVERY_HOUR))
```

No `ClientsModule`, no `APP_GUARD` override, no Redis microservice connection.

### `apps/notifications` Module Graph

```text
AppModule
├─ SharedModule.register()
│   └─ (same as above)
│
└─ QueueModule.registerQueues([QUEUES.EMAIL])
    └─ BullModule (@nestjs/bullmq) — email-queue → Redis
```

### `apps/worker` Module Graph

```text
AppModule
├─ SharedModule.register()
│   └─ (same as above)
│
├─ QueueModule.registerQueues([QUEUES.EMAIL])
│   └─ BullModule (@nestjs/bullmq) — email-queue → Redis
│       EmailConsumer extends WorkerHost (@Processor)
│
└─ MailModule.forRootAsync({ provider: 'brevo', ... })
    └─ Brevo SDK (HTTP → external)
```

---

## Database Schema Dependencies

```
packages/database/prisma/auth.prisma
  User ─── Session (1:N, cascade delete)
  User ─── Account (1:N, cascade delete)
  User ─── TwoFactor (1:N, cascade delete)
  Verification (standalone — identifier + value + expiresAt)
```

`packages/database/prisma/schema.prisma` contains only the generator and datasource. Application-domain models are added here as the app grows.
