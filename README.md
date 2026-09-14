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
| Email             | Brevo (via `@getbrevo/brevo`)                       |
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
  mail/           # MailModule (Brevo provider, MongoDB email logging)
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
| Cron                    | <http://localhost:3200>      |
| Notifications           | <http://localhost:3300>      |
| Worker                  | <http://localhost:3400>      |
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

All six better-auth lifecycle events trigger email notifications:

| Event                               | Email Sent                    |
| ----------------------------------- | ----------------------------- |
| `USER_CREATED`                      | Welcome email                 |
| `USER_PASSWORD_RESET_REQUESTED`     | Password reset                |
| `USER_PASSWORD_CHANGED`             | Password changed confirmation |
| `USER_EMAIL_VERIFICATION_REQUESTED` | Email verification            |
| `USER_TWO_FACTOR_ENABLED`           | 2FA enabled confirmation      |
| `USER_TWO_FACTOR_DISABLED`          | 2FA disabled confirmation     |

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
```

### `apps/cron/.env`

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

### `apps/notifications/.env`

```env
PORT=3300
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
PORT=3400
DATABASE_URL=postgresql://nestjs:change-me@localhost:5432/nestjs
REDIS_HOST=localhost
REDIS_PORT=6379
MONGO_URI=mongodb://nestjs:change-me@localhost:27017/nestjs?authSource=admin
CORS_ORIGIN=http://localhost:8080
BREVO_API_KEY=your-brevo-api-key
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

`METRICS_TOKEN` and `SENTRY_DSN` are optional on every NestJS app — leave them empty to disable auth on the metrics endpoint / disable Sentry.

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
| `EVENT_PATTERNS`   | `USER_CREATED`, `USER_PASSWORD_RESET_REQUESTED`, `USER_PASSWORD_CHANGED`, `USER_EMAIL_VERIFICATION_REQUESTED`, `USER_TWO_FACTOR_ENABLED`, `USER_TWO_FACTOR_DISABLED`                 |
| `MESSAGE_PATTERNS` | `AUTH_AUTHENTICATE`                                                                                                                                                                  |
| `JOB_PATTERNS`     | `SEND_WELCOME_EMAIL`, `SEND_PASSWORD_RESET_EMAIL`, `SEND_PASSWORD_CHANGED_EMAIL`, `SEND_EMAIL_VERIFICATION_EMAIL`, `SEND_TWO_FACTOR_ENABLED_EMAIL`, `SEND_TWO_FACTOR_DISABLED_EMAIL` |

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

Email delivery via Brevo. Configure with `MailModule.forRootAsync()`. Logs all sent emails to MongoDB (`EmailLog`) with a 30-day TTL.

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
