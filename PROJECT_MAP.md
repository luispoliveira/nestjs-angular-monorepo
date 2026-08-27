# PROJECT_MAP.md — NestJS + Angular Monorepo

Codebase map for rapid orientation. Every top-level directory described with its role and key files.

See also: [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) | [ENTRYPOINTS.md](ENTRYPOINTS.md) | [CONVENTIONS.md](CONVENTIONS.md) | [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)

---

## Workspace Root

| File / Dir            | Purpose                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `package.json`        | Root workspace; pnpm scripts (`dev`, `build`, `lint`, `db:*`, `docker:*`)                                  |
| `pnpm-workspace.yaml` | Declares `apps/*` and `packages/*`; pins `zod ~4.4.3` globally                                             |
| `turbo.json`          | Turborepo pipeline: build, dev, lint, test, test:cov, test:integration, test:e2e, check-types, db:\* tasks |
| `docker-compose.yaml` | Local infra: PostgreSQL, MongoDB, Redis, Prometheus, Grafana (per-app service defs + Traefik kept commented for future prod use) |
| `.nvmrc`              | Node `>=22` (pinned `v24.19.0`)                                                                             |
| `docker/`             | Compose service config: `docker/prometheus/prometheus.yml` (scrape config), `docker/grafana/provisioning/` (datasource), `postgres.env`/`mongo.env` |
| `openspec/specs/`     | Archived OpenSpec specs, one per shipped change (e.g. `angular-web-app/spec.md`, `local-observability-stack/spec.md`) |
| `openspec/changes/archive/` | Completed OpenSpec change proposals, incl. `2026-08-26-migrate-web-to-angular` (Next.js → Angular migration) |
| `CLAUDE.md`           | AI assistant instructions                                                                                  |
| `.github/`            | Copilot instructions, git commit rules, PR templates                                                       |
| `.claude/`            | Agent definitions, corner-cases log                                                                        |

---

## `apps/`

### `apps/auth/`

**Role**: NestJS authentication service (primary backend). Port `3000`.

- Manages user sessions via `better-auth` + Prisma adapter.
- Exposes REST API at `/api/auth` + microservice listener on Redis.
- Plugins: `twoFactor()`, `admin()`, Google OAuth.
- Emits Redis events on user lifecycle (created, password reset, password changed, email verification, 2FA toggles).
- Key files:
  - `src/main.ts` — Bootstrap + Redis transport setup
  - `src/app.module.ts` — Root module; `AuthGuard` (`@thallesp/nestjs-better-auth`) as `APP_GUARD`; `betterAuth()` config with hooks that call `NotificationsPublisher`
  - `src/auth.controller.ts` — `@MessagePattern(AUTH_AUTHENTICATE)` handler
  - `src/local-auth.service.ts` — `publisherProxy` bridging `NotificationsPublisher` into the `betterAuth()` factory (created before the Nest DI container exists)
  - `src/env.ts` — `authEnvSchema`

---

### `apps/api/`

**Role**: NestJS REST HTTP gateway for `apps/web`'s own backend calls. Port `3100`. Sits behind Nginx in production.

- Plain REST controllers — tRPC was removed in the Next.js → Angular migration (`openspec/changes/archive/2026-08-26-migrate-web-to-angular`).
- `MicroserviceAuthGuard` is the global `APP_GUARD`; calls into `apps/auth` over Redis (`MESSAGE_PATTERNS.AUTH_AUTHENTICATE`) to validate sessions.
- Registers an `AUTH_SERVICE` Redis client (`ClientsModule`) — it does **not** listen as a microservice.
- Key files:
  - `src/main.ts` — Bootstrap: `globalPrefix='api'`, helmet, versioning, Swagger (non-production), CORS, cookie-parser, `trustProxy: true`
  - `src/app.module.ts` — `SharedModule` + `ClientsModule` (AUTH service) + `MicroserviceAuthGuard` as `APP_GUARD`
  - `src/app.controller.ts` — `GET /api` hello stub, decorated `@RateLimit('default')`
  - `src/env.ts` — `apiEnvSchema`
  - `src/app.controller.spec.ts` — unit test

---

### `apps/cron/`

**Role**: NestJS scheduled-jobs runner. Port `3200`. No business HTTP routes — health/metrics/docs only.

| Path                                        | Role                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main.ts`                                | Bootstrap: `globalPrefix='api'`, no Redis microservice transport             |
| `src/app.module.ts`                          | Imports `SharedModule`, `ScheduleModule.forRoot()`; registers cron providers |
| `src/env.ts`                                 | `cronEnvSchema` — app-specific env validation                                |
| `src/example/example-cron.service.ts`        | Example `@Cron(CronExpression.EVERY_HOUR)` job (`Europe/Lisbon` timezone)     |
| `src/example/example-cron.service.spec.ts`   | Unit test for the example cron job                                           |

> `ExampleCronService` carries a `ponytail:` comment: run this app single-instance
> (e.g. PM2 `fork` with 1 instance) so jobs don't fire once per replica. Upgrade
> path if HA scheduling is ever needed: a Redis lock or a BullMQ repeatable job.

---

### `apps/notifications/`

Redis-event–driven notification dispatcher. Enqueues email jobs into BullMQ.

| Path                         | Role                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `src/main.ts`                | Bootstrap: `globalPrefix='api'`, Redis microservice transport, port `3300` |
| `src/app.module.ts`          | Imports `SharedModule`, `QueueModule.registerQueues([QUEUES.EMAIL])`       |
| `src/app.controller.ts`      | Six `@EventPattern` handlers (see [ENTRYPOINTS.md](ENTRYPOINTS.md))        |
| `src/app.service.ts`         | Delegates to `EmailProducer` for each event type                           |
| `src/env.ts`                 | `notificationsEnvSchema`                                                   |
| `src/app.controller.spec.ts` | Unit tests for `AppController`                                             |
| `src/app.service.spec.ts`    | Unit tests for `AppService`                                                |

---

### `apps/worker/`

BullMQ consumer. Processes email jobs and handles the Dead Letter Queue.

| Path                                        | Role                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/main.ts`                               | Bootstrap: `globalPrefix='api'`, Redis microservice transport, port `3400`                      |
| `src/app.module.ts`                         | Imports `SharedModule`, `QueueModule.registerQueues([QUEUES.EMAIL])`, `MailModule`, `DlqModule` |
| `src/consumer/email.consumer.ts`            | `@Processor(QUEUES.EMAIL)` — dispatches on `job.name`; routes exhausted jobs to DLQ, records metrics via `QueueMetricsService` |
| `src/consumer/email.consumer.spec.ts`       | Unit tests for `EmailConsumer`                                                                  |
| `src/dlq/dlq.controller.ts`                 | Three `@MessagePattern` handlers: `dlq:list`, `dlq:replay`, `dlq:purge`                         |
| `src/dlq/dlq.controller.spec.ts`            | Unit tests for `DlqController`                                                                  |
| `src/dlq/dlq.module.ts`                     | Registers `QueueModule.registerQueues([QUEUES.EMAIL])`, `EmailDlqService`, `DlqController`      |
| `src/dlq/email.dlq.service.ts`              | Extends `BaseDlqService`; list/replay/purge DLQ jobs                                            |
| `src/dlq/email.dlq.service.spec.ts`         | Unit tests for `EmailDlqService`                                                                |
| `src/dlq/base.dlq.service.spec.ts`          | Unit tests for `BaseDlqService` (shared abstract)                                               |
| `src/metrics/queue-metrics.service.ts`      | Prometheus gauges and histograms for queue depth, job duration, failure count                   |
| `src/metrics/queue-metrics.service.spec.ts` | Unit tests for `QueueMetricsService`                                                            |
| `src/env.ts`                                | `workerEnvSchema`                                                                                |

---

### `apps/web/`

Angular 22 admin dashboard (standalone components, signals, Angular Material + Tailwind v4). Dev server on port `4200` (`ng serve --port 4200`); production build served by Nginx on port `8080` (see `Dockerfile`/`nginx.conf.template`), proxying `/api/*` to `apps/api`. No tRPC — REST only, via the frontend's own backend (`apps/api`).

| Path                                                       | Role                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/app/app.ts`                                             | Root standalone component (`<router-outlet>`)                                                 |
| `src/app/app.routes.ts`                                      | Route table: `/sign-in` (`guestGuard`); protected shell (`authGuard`) with children `dashboard`, `account`, `users` + `users/:id` (`adminGuard`) |
| `src/app/app.config.ts`                                      | `ApplicationConfig` — `provideRouter`, `provideTanStackQuery(createQueryClient())`, `provideBrowserGlobalErrorListeners` |
| `src/app/query-client.ts`                                    | `createQueryClient()` — TanStack `QueryClient`, 60 s default `staleTime`                       |
| `src/app/config/app-config.ts`                                | `webConfig` — runtime config (e.g. `authApiUrl`)                                               |
| `src/app/auth/auth-client.ts`                                 | `authClient` — vanilla `better-auth/client`, plugins `twoFactorClient()` + `adminClient()`     |
| `src/app/auth/auth-client.token.ts`                           | `AUTH_CLIENT` `InjectionToken` — DI seam so tests can substitute a fake client                |
| `src/app/auth/session.service.ts`                             | `SessionService` — signal-backed bridge over `authClient.useSession` (`session`, `user`, `isAuthenticated`, `isImpersonating`, `ready()`) |
| `src/app/auth/auth.guard.ts`                                  | `authGuard`, `guestGuard` — functional `CanActivateFn`s, await `session.ready()` before deciding |
| `src/app/auth/admin.guard.ts`                                 | `adminGuard` — functional guard checking `RoleEnum.ADMIN`                                      |
| `src/app/theme/theme.service.ts`                              | `ThemeService` — signal-backed light/dark mode, persisted to `localStorage`                    |
| `src/app/shell/shell.ts`                                      | Authenticated shell layout (nav + `<router-outlet>`)                                           |
| `src/app/features/sign-in/sign-in.ts`                         | Sign-in form (reactive forms + `zodValidator(signInSchema)`)                                   |
| `src/app/features/dashboard/dashboard.ts`                     | Dashboard home                                                                                 |
| `src/app/features/account/account.ts`                        | Account/profile page                                                                           |
| `src/app/features/users/users.ts`                             | Admin-only users list                                                                          |
| `src/app/features/users/user-detail/user-detail.ts`           | Admin-only user detail page                                                                    |
| `src/app/features/users/create-user-dialog/create-user-dialog.ts` | `MatDialog` — create user                                                                  |
| `src/app/features/users/edit-role-dialog/edit-role-dialog.ts` | `MatDialog` — edit role                                                                        |
| `src/app/features/users/ban-user-dialog/ban-user-dialog.ts`   | `MatDialog` — ban user                                                                          |
| `src/app/features/users/confirm-dialog/confirm-dialog.ts`     | Generic `MatDialog` confirmation                                                                |
| `src/index.html`                                              | Inline pre-bootstrap script applies the stored theme before Angular loads (avoids flash)       |
| `nginx.conf.template`                                         | Prod Nginx config: static-asset `try_files ... =404`, SPA fallback for routes, proxies `/api/` to `API_UPSTREAM` |
| `Dockerfile`                                                  | Multi-stage build → `nginx:1-alpine` serving `dist/web/browser`                                |

---

## `packages/`

### `packages/shared/`

Global NestJS infrastructure. Imported by every backend app (`apps/auth`, `apps/api`, `apps/cron`, `apps/notifications`, `apps/worker`).

| Sub-path              | Contents                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/abstracts/`      | `BaseProducer`, `BasePublisher`, `BaseDlqService`; spec files for each                                                                                       |
| `src/config/`         | `baseEnvSchema` — shared env validation base (`NODE_ENV`, `DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, `MONGO_URI`, `PORT`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`), extended per-app in each `env.ts` |
| `src/constants/`      | `SERVICES`, `QUEUES`, `EVENT_PATTERNS`, `MESSAGE_PATTERNS`, `JOB_PATTERNS`, `CLS_CORRELATION_ID`, `THROTTLE_TIERS`                                           |
| `src/decorators/`     | `@Public()`, `@CurrentUser()`, `@RateLimit(tier)`                                                                                                            |
| `src/encryption/`     | `EncryptionService`, `encryption.util` — AES field crypto + blind index                                                                                      |
| `src/enums/`          | Barrel re-export point (currently empty)                                                                                                                     |
| `src/filters/`        | `AllExceptionFilter` — HTTP + RPC exception handler, Sentry capture; `http-exception.filter.spec.ts`                                                         |
| `src/guards/`         | `CustomThrottlerGuard`, `MicroserviceAuthGuard`; spec files for each                                                                                         |
| `src/health/`         | `HealthController` — `GET /health/live`, `GET /health/ready`                                                                                                 |
| `src/interceptors/`   | `LoggingInterceptor` (MongoDB), `CorrelationInterceptor`; spec files for each                                                                                |
| `src/interfaces/`     | `BaseService<T>` — `findOneById(id): Promise<T>`                                                                                                             |
| `src/logging/`        | `pino.config.ts` — pino logger config (pretty in dev, JSON in prod)                                                                                          |
| `src/metrics/`        | `MetricsModule`, `MetricsController` (`GET /metrics`), `HttpMetricsInterceptor`, `MetricsAuthGuard`; spec files for interceptor and guard                    |
| `src/modules/`        | `SharedModule` (global, dynamic)                                                                                                                             |
| `src/mongo/`          | `MongoModule`, `MongoService`, `Log` schema, `EmailLog` schema; `mongo.service.spec.ts`                                                                      |
| `src/publishers/`     | `NotificationsPublisher`, publisher input DTOs; `notifications.publisher.spec.ts`                                                                            |
| `src/queue/`          | `QueueModule`, `EmailProducer`, job input DTOs + schemas; `email.producer.spec.ts`                                                                           |
| `src/types/`          | `PaginatedType`, `PagedMetaType`                                                                                                                             |
| `src/utils/`          | `BootstrapUtil`, `MicroserviceUtil`, `PaginatedUtil`, `ContextUtil`, `SanitizeUtil`, `SentryUtil`, `LoggerUtil`; spec files for context, paginated, sanitize, sentry, bootstrap utils |
| `tsconfig.build.json` | Extends `tsconfig.json`; excludes `**/*.spec.ts` — used by `build` and `dev` scripts                                                                         |
| `tsconfig.test.json`  | Extends `tsconfig.json`; sets `module: commonjs`, `moduleResolution: node`, `resolvePackageJsonExports: false` — used by ts-jest                             |

### `packages/database/`

Prisma 7 client and database infrastructure.

| Path                                  | Role                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                | Generator (CJS output to `generated/prisma`), datasource (PostgreSQL)                                          |
| `prisma/auth.prisma`                  | better-auth models: `User`, `Session`, `Account`, `Verification`, `TwoFactor`                                  |
| `src/database.service.ts`             | `DatabaseService extends PrismaClient` with `PrismaPg` adapter                                                 |
| `src/database.module.ts`              | `DatabaseModule` — global, exports `DatabaseService`                                                           |
| `src/database-seeder.service.ts`      | Runs registered seeders on `onModuleInit`                                                                      |
| `src/seeders/`                        | Seeder implementations, registered in `DatabaseSeederService` (currently empty — extension point)              |
| `src/index.ts`                        | Barrel re-export including Prisma generated client                                                             |
| `src/database.service.spec.ts`        | Unit tests for `DatabaseService`                                                                               |
| `src/database-seeder.service.spec.ts` | Unit tests for `DatabaseSeederService`                                                                         |
| `tsconfig.build.json`                 | Extends `tsconfig.json`; excludes `**/*.spec.ts`                                                               |
| `tsconfig.test.json`                  | Extends `tsconfig.json`; sets `module: commonjs`, `moduleResolution: node`, `resolvePackageJsonExports: false` |

### `packages/shared-types/`

Zod v4 schemas shared between `apps/web` (Angular) and the NestJS apps — the same schema drives backend DTO validation and Angular reactive-form validation via `zodValidator()`.

| Path                                | Contents                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------|
| `src/schemas/auth.schema.ts`        | `signInSchema` — shared by the Angular sign-in form's `zodValidator()`                          |
| `src/schemas/base-entity.schema.ts` | `baseEntitySchema` — `id`, `createdAt`, `updatedAt`, `deletedAt`, audit fields                   |
| `src/schemas/date.schema.ts`        | `DateToISOString` / `NullableDateToISOString` — Zod codec: Prisma `Date` ↔ ISO 8601 string        |
| `src/schemas/paginated.schema.ts`   | `pagedMetaSchema`, `paginatedSchema(itemSchema)` — `{ items, meta }` response wrapper            |
| `src/schemas/pagination.schema.ts`  | `paginationSchema` — `skip`, `take` (max 100), `sortBy`, `sortOrder`                              |
| `src/schemas/user.schema.ts`        | `createUserSchema`, `editRoleSchema`, `userSchema` (better-auth admin `UserWithRole` shape)       |
| `src/enums/role.enum.ts`            | `RoleEnum` — `admin`, `user`                                                                      |
| `src/enums/environment.enum.ts`     | `EnvironmentEnum`                                                                                  |
| `src/validators/zod.validator.ts`   | `zodValidator(schema)` — adapts a Zod schema into an Angular `ValidatorFn`                        |

### `packages/mail/`

Email delivery abstraction. Currently supports Brevo only.

| Path                                   | Role                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/mail.module.ts`                   | Dynamic module — `forRoot` / `forRootAsync`; provider: `'brevo'`                                               |
| `src/mail.service.ts`                  | `send()` with 3-attempt exponential retry; dev-mode email redirect; logs via `MongoService`                    |
| `src/providers/brevo.provider.ts`      | Brevo (Sendinblue) API integration                                                                             |
| `src/interfaces/`                      | `MailModuleOptions`, `MailProvider` interfaces                                                                 |
| `src/mail.service.spec.ts`             | Unit tests for `MailService`                                                                                   |
| `src/providers/brevo.provider.spec.ts` | Unit tests for `BrevoProvider`                                                                                 |
| `tsconfig.build.json`                  | Extends `tsconfig.json`; excludes `**/*.spec.ts`                                                               |
| `tsconfig.test.json`                   | Extends `tsconfig.json`; sets `module: commonjs`, `moduleResolution: node`, `resolvePackageJsonExports: false` |

### `packages/testing-utils/`

Test-only utilities shared by all backend apps. **Never import in production code.**

| Path                               | Role                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                     | Barrel export                                                                                                          |
| `src/factories/user.factory.ts`    | `createUser(db, overrides?)` — inserts `User` + `Account` (credential provider); exports `TEST_PASSWORD = 'Test1234!'` |
| `src/factories/session.factory.ts` | `createSession(db, userId, overrides?)` — inserts a `Session` expiring 24 h from now                                   |
| `src/factories/index.ts`           | Re-exports factories and their override interfaces                                                                     |
| `src/helpers/truncate.ts`          | `truncateDatabase(db)` — `DELETE` from `verification`, `user` (cascade removes sessions, accounts, 2FA)                |
| `src/helpers/index.ts`             | Re-exports helpers                                                                                                     |

Password hashing in `createUser` matches better-auth's scrypt format exactly (`${salt}:${hex(key)}`, N=16384, r=16, p=1, keylen=64). The hash is cached per process to avoid paying the cost on every test.

### `packages/eslint-config/`

Shared ESLint configurations for all workspaces: `base.js`, `nest.js`, `angular.js`.

### `packages/typescript-config/`

Shared `tsconfig` base files: `base.json`, `nestjs.json`, `angular-app.json`, `react-library.json`.
