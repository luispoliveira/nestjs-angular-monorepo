# NestJS + Angular Monorepo Template

A production-ready, full-stack monorepo template combining NestJS microservices with an Angular admin dashboard. Built on modern tooling with a shared Zod validation contract, async job processing, and a complete authentication system.

## Stack

| Layer             | Technology                                          |
| ----------------- | --------------------------------------------------- |
| Monorepo          | Turborepo + pnpm workspaces                         |
| Backend           | NestJS 11 (TypeScript)                              |
| Frontend          | Angular 22 (standalone, signals), Tailwind CSS v4, Angular Material |
| Database          | PostgreSQL via Prisma 7 (PrismaPg adapter)          |
| Logging/Audit     | MongoDB via Mongoose (30-day TTL)                   |
| Cache / Transport | Redis                                               |
| Auth              | `better-auth` + `@thallesp/nestjs-better-auth`      |
| Validation        | Zod v4 + `nestjs-zod`                               |
| API Contract      | REST (`apps/api`), same-origin from the frontend    |
| Queue             | BullMQ via `@nestjs/bullmq`                         |
| Email             | Brevo (`@getbrevo/brevo`) or Resend, via `MAIL_PROVIDER` |
| Logging           | `nestjs-pino` with correlation IDs via `nestjs-cls` |
| Health            | `@nestjs/terminus`                                  |
| Observability     | Prometheus + Grafana + Loki (local docker-compose stack) |

## Workspace Structure

```
apps/
  auth/           # NestJS — Auth service (HTTP + Redis microservice)
  api/            # NestJS — REST HTTP gateway for the frontend's own backend
  cron/           # NestJS — Scheduled jobs (@nestjs/schedule), health/metrics HTTP only
  notifications/  # NestJS — Notification microservice (Redis events → BullMQ jobs)
  worker/         # NestJS — BullMQ worker (processes email jobs via Brevo)
  web/            # Angular — Admin backoffice dashboard (standalone components, signals)
packages/
  database/       # Prisma client, DatabaseModule, DatabaseService, migrations, seeders
  shared/         # Global NestJS infrastructure (SharedModule, guards, interceptors, publishers, queue, health, metrics)
  shared-types/   # Zod v4 schemas + zodValidator() shared between frontend and backend
  mail/           # MailModule (Brevo and Resend providers, MongoDB email logging)
  testing-utils/  # Test factories, DB truncation, testcontainers e2e setup
  eslint-config/  # Shared ESLint configurations
  typescript-config/ # Shared tsconfig bases
docker/
  postgres.env[.example]
  mongo.env[.example]
  prometheus/prometheus.yml     # Scrape config for all NestJS apps
  grafana/provisioning/         # Provisioned Prometheus datasource
tasks/            # PRDs and task lists (template + home platform)
```

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Docker** (for local infrastructure)

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. First-time setup

Run the interactive setup wizard. It will ask for the project name, PostgreSQL credentials, and MongoDB credentials, then generate all `.env` files and Docker env files automatically:

```bash
pnpm setup
```

The wizard will:

- Update the project name in `package.json`
- Prompt for **PostgreSQL** database name, username, and password
- Prompt for **MongoDB** database name, username, and password
- Copy every `.env.example` → `.env` (root and all apps) with the provided credentials substituted in all connection strings
- Generate `BETTER_AUTH_SECRET` (`apps/auth`) and the two field-encryption keys `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_HMAC_KEY` (`apps/api`)
- Copy `docker/postgres.env.example` → `docker/postgres.env`
- Copy `docker/mongo.env.example` → `docker/mongo.env`

> Files that already exist are skipped automatically — safe to re-run.

See [Environment Variables](#environment-variables) for a description of each variable.

### 3. Start infrastructure

```bash
pnpm docker:up
```

This starts PostgreSQL (5432), Redis (6379), MongoDB (27017), Prometheus (9090), and Grafana (3333).

> On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `prometheus` service in `docker-compose.yaml` so it can reach the apps running on the host — see the comment in `docker/prometheus/prometheus.yml`.

### 4. Run database migrations

```bash
pnpm db:generate   # Generate Prisma client
pnpm db:migrate    # Run migrations
pnpm db:seed       # Seed initial data (creates admin user)
```

### 5. Start all services

```bash
pnpm dev
```

| Service                 | URL                          |
| ----------------------- | ---------------------------- |
| Auth API                | <http://localhost:3000>      |
| Auth API Docs (Swagger) | <http://localhost:3000/docs> |
| API                     | <http://localhost:3100>      |
| Cron                    | <http://localhost:3400>      |
| Notifications           | <http://localhost:3200>      |
| Worker                  | <http://localhost:3300>      |
| Web (backoffice, `ng serve`) | <http://localhost:4200> |
| Prometheus              | <http://localhost:9090>      |
| Grafana                 | <http://localhost:3333>      |

Every NestJS app shares the same `globalPrefix: 'api'` — they are told apart by **port**, not by path. In development, `apps/web` reaches `apps/auth` cross-origin (`http://localhost:3000`, per `authApiUrl` in `apps/web/src/environments/environment.ts`) — the same cross-origin path deployed environments use — and its own `apps/api` same-origin under `/api/` via `apps/web/proxy.conf.json`. In production, `apps/web` is a static build served by nginx, not a running dev server — see [nginx / split-subdomain topology](#docker--production) below.

## Commands

All commands use **Turborepo** for caching and parallel execution.

```bash
pnpm setup           # Interactive first-time setup wizard (env files + credentials)

pnpm build           # Build all apps and packages
pnpm dev             # Start all services in watch mode
pnpm lint            # Lint all packages
pnpm check-types     # TypeScript type-check all packages
pnpm test            # Run all tests

pnpm db:generate     # Prisma: generate client
pnpm db:migrate      # Prisma: run migrations (prod)
pnpm db:seed         # Prisma: seed database

pnpm docker:up       # Start infrastructure containers
pnpm docker:down     # Stop infrastructure containers
```

> Always use `pnpm` — never npm or yarn.

## Testing

Unit tests use **Jest + ts-jest** and run entirely on the host (no Docker required). Each NestJS app has its own test configuration in its `package.json`.

`apps/auth`'s `test:integration` and `test:e2e` suites are the exception: they start disposable Postgres, MongoDB and Redis containers per run, so Docker must be running. They never touch a local database.

### Run all tests (all apps, via Turborepo)

```bash
pnpm test
```

### Run tests for a single app

```bash
pnpm --filter api          test
pnpm --filter auth         test
pnpm --filter cron         test
pnpm --filter notifications test
pnpm --filter worker       test
```

### Watch mode (re-runs on file save)

```bash
pnpm --filter api test -- --watch
```

### Coverage report

```bash
# Single app — outputs to apps/<name>/coverage/
pnpm --filter api          test:cov
pnpm --filter auth         test:cov
pnpm --filter cron         test:cov
pnpm --filter notifications test:cov
pnpm --filter worker       test:cov

# Open the HTML report in the browser
open apps/api/coverage/lcov-report/index.html
```

Coverage thresholds are enforced at **80 %** (branches, functions, lines, statements). The build fails if any app falls below the threshold.

### Run a single test file

```bash
cd apps/api
pnpm test -- src/app.controller.spec.ts
```

### Run tests matching a name pattern

```bash
cd apps/api
pnpm test -- --testNamePattern="should return"
```

### Technical notes

- Each app has a `tsconfig.test.json` that overrides `module: "commonjs"` so that ts-jest can process files without ESM issues.
- ESM-only packages (e.g. `@thallesp/nestjs-better-auth`) are replaced with `jest.mock('pkg', factory)` — do not import `AppModule` in unit tests.
- Never use `SharedModule` or `AppModule` in unit tests — only import the controller/service under test.

## Architecture

### Microservice Communication

Services communicate via **Redis transport** using predefined constants from `@repo/shared`:

```
[web (Angular)]  →  better-auth client, cross-origin   →  [auth]
[web (Angular)]  →  REST, same-origin /api/             →  [api]
[auth]           →  Redis EventPattern                 →  [notifications]
[notifications]  →  BullMQ Queue (email-queue)         →  [worker]
[worker]         →  Brevo API                          →  Email delivery
[cron]           →  @nestjs/schedule                   →  Scheduled jobs (no upstream trigger)
```

The `auth` service also exposes a `MESSAGE_PATTERNS.AUTH_AUTHENTICATE` RPC endpoint used by other services to validate session tokens.

### Authentication Flow

1. User authenticates via `/api/auth/*` (better-auth HTTP handlers)
2. Session cookie is set by better-auth — `Secure`-prefixed, `SameSite=Lax`, scoped to the shared parent domain in production for SSO across sibling subdomains
3. A functional Angular route guard (`authGuard`) awaits the session's first resolution and redirects to `/sign-in` if unauthenticated — enforced client-side, since the frontend is a static bundle with no server of its own
4. Components call REST endpoints through the injected `AUTH_CLIENT` (the vanilla `better-auth/client`) for auth context, and `apps/api` directly for the frontend's own data

### Email Notification Pipeline

All eight better-auth lifecycle events trigger email notifications:

| Event                               | Email Sent                    |
| ----------------------------------- | ----------------------------- |
| `USER_CREATED`                      | Welcome email (self sign-up)  |
| `USER_INVITED`                      | Invitation to set a password (account created by an admin) |
| `USER_ACCOUNT_ACTIVATED`            | Account activated (first password set) |
| `USER_PASSWORD_RESET_REQUESTED`     | Password reset                |
| `USER_PASSWORD_CHANGED`             | Password changed confirmation |
| `USER_EMAIL_VERIFICATION_REQUESTED` | Email verification            |
| `USER_TWO_FACTOR_ENABLED`           | 2FA enabled confirmation      |
| `USER_TWO_FACTOR_DISABLED`          | 2FA disabled confirmation     |

An administrator never sees or sets a new user's password: creating a user emails them an invitation (a single-use `/reset-password` link, valid one hour) and setting the first password activates the account. A reset requested for an account that never set a password re-sends the invitation.

## Environment Variables

### `apps/auth/.env`

```env
PORT=3000
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000/api/auth
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:3000,http://localhost:4200
UI_URL=http://localhost:4200
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
METRICS_TOKEN=
SENTRY_DSN=
AUDIT_RETENTION_DAYS=365
```

### `apps/api/.env`

```env
PORT=3100
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:3000
METRICS_TOKEN=
SENTRY_DSN=
FIELD_ENCRYPTION_KEY=<base64, 32 bytes>
FIELD_ENCRYPTION_HMAC_KEY=<base64>
AUDIT_RETENTION_DAYS=365
```

`AUDIT_RETENTION_DAYS` (optional, default `365`; on `apps/auth` and `apps/api`) is how many days an [audit event](#audit-log) is kept. Each event stores its own expiry, so changing the value only affects events recorded afterwards; existing events keep the expiry they were given.

`FIELD_ENCRYPTION_KEY` (AES-256-GCM) and `FIELD_ENCRYPTION_HMAC_KEY` (blind index) protect PII columns at rest, such as the customer NIF. Both are required: the API refuses to boot without them, or when the encryption key does not decode to 32 bytes. `pnpm setup` generates them. To generate one by hand: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

> **Back the keys up.** Losing or changing either key makes the stored values unreadable (encryption key) or unsearchable and no longer unique (HMAC key). Key rotation is not supported.
>
> When you add a new PII field, also append its key name to `SENSITIVE_KEYS` in `packages/shared/src/utils/sanitize.util.ts` and its `req.body.*` path to `redact.paths` in `packages/shared/src/logging/pino.config.ts`, so its plaintext never reaches the request logs.

### `apps/cron/.env`

```env
PORT=3400
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:8080
METRICS_TOKEN=
SENTRY_DSN=
```

### `apps/notifications/.env`

```env
PORT=3200
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:8080
METRICS_TOKEN=
SENTRY_DSN=
```

### `apps/worker/.env`

```env
PORT=3300
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:8080
MAIL_PROVIDER=brevo # or resend; only the active provider's key is required
BREVO_API_KEY=your-brevo-api-key
# RESEND_API_KEY=re_...
FROM_EMAIL=no-reply@example.com
FROM_NAME=My App
DEV_EMAIL=dev@example.com
METRICS_TOKEN=
SENTRY_DSN=
```

### `apps/web`

Angular has no runtime `.env` — configuration is baked in at **build time** via `apps/web/src/environments/{environment.ts,environment.prod.ts}`, swapped by `angular.json`'s `production` `fileReplacements` (see the `nginx-subdomain-topology` capability in the archived `migrate-web-to-angular` openspec change for the full rationale):

```typescript
// environment.ts (development — used by `ng serve` / a dev build)
export const environment = {
  authApiUrl: 'http://localhost:3000', // cross-origin, same as deployed environments
};

// environment.prod.ts (production — set the real public auth origin before building)
export const environment = {
  authApiUrl: 'https://auth.example.com',
};
```

The frontend's own API is always the relative `/api` prefix, proxied same-origin (`apps/web/proxy.conf.json` in dev, nginx in production) — never a configured host.

`SENTRY_DSN` is optional on every NestJS app — leave it empty to disable Sentry. `METRICS_TOKEN` may be left empty outside production (the metrics endpoint is then open), but in production an empty token makes `/api/metrics` refuse every request.

### PWA

The web app is installable (`apps/web/public/manifest.webmanifest`) and, in production builds only, registers an Angular service worker that caches the static shell so it still loads after a brief loss of connectivity. API data (`/api/**`) is never cached, and a navigation to an `/api/` path reaches the server instead of receiving `index.html`. To brand it, replace the placeholder files in `apps/web/public/icons/` (same names and sizes) and edit `name`, `short_name` and `theme_color` in the manifest. The web server must serve `ngsw-worker.js` and `ngsw.json` with `Cache-Control: no-cache` (see [DEPLOY.md](DEPLOY.md)).

## Internal Packages

All internal packages use the `@repo/` prefix.

### `@repo/shared`

Global NestJS infrastructure. Every NestJS app **must** import `SharedModule` first.

`SharedModule.register()` provides globally:

- `ConfigModule` (`.env`)
- `DatabaseModule` (Prisma via PrismaPg)
- `MongoModule` (Mongoose for logs/audit)
- `LoggerModule` (nestjs-pino — pretty in dev, JSON in prod)
- `ThrottlerModule` (10 req / 60s by default)
- `ClsModule` (correlation IDs on HTTP + RPC)
- `TerminusModule` + `HealthController` (`GET /health/live`, `GET /health/ready`)
- Global: `AllExceptionFilter`, `LoggingInterceptor`, `CorrelationInterceptor`, `ZodValidationPipe`, `ZodSerializerInterceptor`

#### Constants

Never hardcode queue names, service tokens, or event patterns. Always import from `@repo/shared`:

```typescript
import {
  SERVICES,
  QUEUES,
  EVENT_PATTERNS,
  MESSAGE_PATTERNS,
  JOB_PATTERNS,
} from '@repo/shared';
```

| Constant           | Values                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SERVICES`         | `AUTH`, `NOTIFICATIONS`                                                                                                                                                              |
| `QUEUES`           | `EMAIL: 'email-queue'`, `EMAIL_DLQ: 'email-queue-dlq'`                                                                                                                               |
| `EVENT_PATTERNS`   | `USER_CREATED`, `USER_PASSWORD_RESET_REQUESTED`, `USER_PASSWORD_CHANGED`, `USER_EMAIL_VERIFICATION_REQUESTED`, `USER_TWO_FACTOR_ENABLED`, `USER_TWO_FACTOR_DISABLED`, `USER_INVITED`, `USER_ACCOUNT_ACTIVATED`                 |
| `MESSAGE_PATTERNS` | `AUTH_AUTHENTICATE`                                                                                                                                                                  |
| `JOB_PATTERNS`     | `SEND_WELCOME_EMAIL`, `SEND_PASSWORD_RESET_EMAIL`, `SEND_PASSWORD_CHANGED_EMAIL`, `SEND_EMAIL_VERIFICATION_EMAIL`, `SEND_TWO_FACTOR_ENABLED_EMAIL`, `SEND_TWO_FACTOR_DISABLED_EMAIL`, `SEND_ACCOUNT_INVITATION_EMAIL`, `SEND_ACCOUNT_ACTIVATED_EMAIL` |

### `@repo/database`

Prisma 7 client with PrismaPg adapter. Schema is split:

- `schema.prisma` — application models
- `auth.prisma` — better-auth models (**do not modify**)

### `@repo/shared-types`

Zod v4 schemas shared between frontend and backend:

```typescript
import {
  RoleEnum,
  paginationSchema,
  createUserSchema,
} from '@repo/shared-types';
```

### `@repo/mail`

Email delivery via Brevo (default) or Resend, chosen with `MAIL_PROVIDER`. Configure with `MailModule.forRootAsync()`. Logs all sent emails to MongoDB (`EmailLog`) with a 30-day TTL.

## Audit log

Authentication, account-management and customer write actions are recorded in an append-only MongoDB collection (`audit_events`), separate from the HTTP request `Log`. Admins read it on the `/audit` page (`GET /api/v1/audit-events`), filtering by action, outcome, actor (email or id), target and dates. An email also finds the failed sign-ins that tried it.

- **What is recorded:** `apps/auth` records every audited better-auth route (sign-in/up/out, password and email changes, 2FA, session revocation, and the admin user actions: create, update, remove, ban, unban, role, password, impersonate), on success **and** on failure. `apps/api` records the writes marked with `@Audit`. Reads are never recorded.
- **What an event holds:** actor (and the real admin during an impersonation), action, target, outcome with error code, changed **field names**, values only for `role`, `banned`, `banReason` and `banExpires`, IP, user agent and the request's correlation ID. Passwords, tokens, codes, NIFs and email values are never stored. A **failed** action records no changed fields or values, since nothing changed. A failed sign-in keeps the attempted email.
- **Best-effort:** if an event cannot be stored the audited action is not affected; the failure goes to the log and Sentry. In `apps/auth` a response waits at most 2 s for its event (`AUDIT_HOOK_MAX_WAIT_MS`), so an unreachable Mongo cannot stall sign-ins.
- **Bounded:** every field a client controls is truncated before storing (emails 254 characters, user agent 256, at most 50 changed-field names of 64, change values 500), so no request can store a large event.
- **Client address:** the entry the trusted proxy appended to `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, 1 for the documented nginx topology, same rule as Express `trust proxy`); the first entry is client-supplied and is never used, and a value that is not an IP address is dropped instead of stored. Behind two proxies, raise `TRUSTED_PROXY_HOPS` in `packages/shared/src/constants/proxy.ts`.
- **Retention:** `AUDIT_RETENTION_DAYS` (default 365). Events cannot be edited or deleted through the API; they only expire.
- **Not an audit trail:** the HTTP request `Log` (30 days) is a debugging aid. It does not see better-auth routes or requests rejected by guards.

To audit a new write in `apps/api`, decorate the handler with `@Audit('<action>', { targetType, fields })` (the action must exist in `AUDIT_ACTIONS` in `@repo/shared-types`). To audit another better-auth endpoint, add its path to `AUTH_AUDIT_PATHS` in `apps/auth/src/audit/auth-audit.ts`.

## Reference slice: Customers

`Customer` is a small end-to-end example that shows how to build a business resource with this template's conventions. Copy it as the starting point for your own resources, or delete it (steps below).

| Layer | Where | Demonstrates |
| --- | --- | --- |
| Schema | `packages/database/prisma/schema.prisma` (`Customer`), migration `*_add_customer` | `cuid` id, timestamps, soft delete (`deletedAt`), index for the default listing, a **partial unique index** (`partialIndexes` preview) so a deleted row frees its NIF |
| Contract | `packages/shared-types/src/schemas/customer.schema.ts` | Request/response/list-query schemas shared by API and web, a `sortBy` allow-list, NIF normalization and mod-11 validation |
| API | `apps/api/src/customers/` → `/api/v1/customers` | `createZodDto` DTOs, `@ZodSerializerDto` responses, `@Roles(ADMIN)` on writes only, P2002 → 409, NIF encrypted with `EncryptionService` and blind-indexed for exact search |
| Web | `apps/web/src/app/features/customers/` → `/customers` | `injectQuery` list with debounced search and paging, network-boundary parsing, one Material dialog for create/edit, 409 shown on the NIF field, write controls for admins only |
| Tests | `*.spec.ts` next to each file, `apps/api/test/customers.integration.ts` | Unit tests per layer plus a Testcontainers integration suite covering 401/403, uniqueness under concurrency, soft delete, search and log redaction |

### Removing it

1. Delete `apps/api/src/customers/`, then remove the `CustomersModule` import from `apps/api/src/app.module.ts`.
2. Delete `apps/api/test/customers.integration.ts` (keep the harness if you want integration tests).
3. Delete `apps/web/src/app/features/customers/`, the `customers` route in `apps/web/src/app/app.routes.ts` and the `Customers` entry in `apps/web/src/app/shell/shell.ts`. If you no longer call `apps/api` from the web app, also drop `provideHttpClient` from `apps/web/src/app/app.config.ts`.
4. Delete `packages/shared-types/src/schemas/customer.schema.ts` and its spec, plus the export in `packages/shared-types/src/schemas/index.ts`.
5. Delete `packages/testing-utils/src/factories/customer.factory.ts`, its exports in `packages/testing-utils/src/factories/index.ts` and `packages/testing-utils/src/index.ts`, and the `customer` line in `packages/testing-utils/src/helpers/truncate.ts`.
6. Remove the `Customer` model (and the `partialIndexes` preview flag if nothing else uses it) from `packages/database/prisma/schema.prisma`. On a fresh project with no applied migrations, delete the `packages/database/prisma/migrations/*_add_customer/` folder. Otherwise run `pnpm db:migrate --name drop_customer`.
7. Keep `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_HMAC_KEY` and the `taxid` redaction key if you store other PII. Otherwise remove them from `apps/api/src/env.ts`, `apps/api/.env.example` and `scripts/setup.mjs`.

## Conventions

### NestJS

- Use `BootstrapUtil.setup()` to configure any HTTP app (Swagger, CORS, cookie-parser, Helmet)
- Use `MicroserviceUtil.registerAuthService()` / `MicroserviceUtil.registerNotificationsService()` to register Redis microservice clients
- Extend `BasePublisher` for Redis event publishers, `BaseProducer` for BullMQ queue producers
- Use `@Public()` to bypass auth, `@CurrentUser()` to inject the current user in controllers

### Angular

- Standalone components only — no `NgModule`s; bootstrap via `bootstrapApplication`
- Data fetching through `@tanstack/angular-query-experimental` (`injectQuery`/`injectMutation`) — never a hand-rolled `HttpClient` call
- Forms validated by `zodValidator(schema)` from `@repo/shared-types` — the same schema the backend validates with
- Auth: inject the `AUTH_CLIENT` token (never the `authClient` singleton directly) and `SessionService` for the signal-backed session
- UI primitives from Angular Material — do not hand-roll dialogs, menus, or tables

### Database

- Model naming: PascalCase name, `@@map("snake_case")` table name
- Always include `id`, `createdAt`, `updatedAt`; prefer `deletedAt` for soft deletes
- `id String @id @default(cuid())`
- MongoDB is for **logs/audit only** — application data lives in PostgreSQL

### Validation

Use Zod v4 APIs throughout:

```typescript
// ✅ Correct (Zod v4)
z.email();
z.string().min(1);

// ❌ Incorrect (Zod v3)
z.string().email();
```

## Health Checks

All NestJS apps expose:

- `GET /health/live` — liveness probe
- `GET /health/ready` — readiness probe (checks database, Redis, MongoDB)
- `GET /api/metrics` — Prometheus metrics, optionally protected by a `METRICS_TOKEN` bearer token

## Observability

`pnpm docker:up` starts a local Prometheus + Grafana + Loki stack alongside the usual infra:

- **Prometheus** (<http://localhost:9090>) scrapes `/api/metrics` on all five NestJS apps (`auth`, `api`, `cron`, `notifications`, `worker`) via `host.docker.internal`. Scrape config: [docker/prometheus/prometheus.yml](docker/prometheus/prometheus.yml).
- **Loki** (<http://localhost:3101> on the host — `apps/api` already uses 3100; the container-internal port stays 3100) stores logs; **Alloy** tails the PM2-managed apps' log files (`./logs/<app>-{out,error}.log`, see [ecosystem.config.js](ecosystem.config.js)) and ships them to Loki, labelling each line with `app`/`stream` parsed from the filename. Config: [docker/alloy/config.alloy](docker/alloy/config.alloy). Nothing to tail in local dev, where apps run via `pnpm dev` on the host instead of under PM2.
- **Grafana** (<http://localhost:3333>, default login `admin` / `admin`) comes with Prometheus and Loki datasources pre-provisioned from [docker/grafana/provisioning/](docker/grafana/provisioning/).

> **Linux only:** Docker on Linux doesn't resolve `host.docker.internal` by default. Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `prometheus` service in `docker-compose.yaml`.

## Docker / Production

The `docker-compose.yaml` includes fully configured (but commented-out) app service definitions with Traefik routing labels, ready to uncomment for deployment. Each app has a `Dockerfile` using a multi-stage build — `apps/web`'s build stage compiles the Angular app and its production stage is a static nginx image (`apps/web/nginx.conf.template`).

`apps/web` and `apps/auth` are deployed on separate sibling subdomains sharing a registrable parent domain, so the session cookie can be widened for single sign-on across them — see [DEPLOY.md](DEPLOY.md) / [DEPLOY-PM2.md](DEPLOY-PM2.md) and the nginx server blocks in [docs/deploy/nginx/](docs/deploy/nginx/) (`frontend.conf`, `auth.conf`).

## License

Private — all rights reserved.
