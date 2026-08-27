# ARCHITECTURE_OVERVIEW.md — NestJS + Angular Monorepo

Detailed architectural description covering service topology, module structure, async communication, and integrations.

See also: [PROJECT_MAP.md](PROJECT_MAP.md) | [ENTRYPOINTS.md](ENTRYPOINTS.md) | [CONVENTIONS.md](CONVENTIONS.md) | [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)

---

## Service Topology

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │ HTTP
                    ┌──────▼──────┐
                    │    Nginx    │  (prod: serves apps/web's static Angular
                    └──┬──────┬───┘   build, proxies /api/* onward)
                       │      │
               HTTP    │      │  HTTP
          ┌────────────▼──┐ ┌─▼────────────────┐
          │  apps/api     │ │  apps/auth        │
          │  :3100/api    │ │  :3000/api/auth   │
          │  REST (own    │ │  better-auth      │
          │  backend for  │ │                   │
          │  apps/web)    │ │                   │
          └───────┬───────┘ └──────────┬────────┘
                  │                    │
    Redis send()  │              Redis emit()
    auth:authenticate              notifications events
                  │                    │
          ┌───────▼────────────────────▼────────┐
          │              Redis                  │
          │   (message transport + BullMQ)      │
          └──┬────────────────────────┬─────────┘
             │                        │
    Redis    │                 BullMQ │ email-queue
    events   │               ┌────────▼──────────┐
             │               │  apps/worker      │
    ┌────────▼───────┐        │  :3400            │
    │ apps/notif-    │        │  EmailConsumer    │
    │ ications       │        │  DLQ: email-queue-dlq │
    │ :3300/api      │        └────────┬──────────┘
    └────────────────┘                 │ SMTP
                                ┌───────▼───────┐
                                │  Brevo (mail) │
                                └───────────────┘
          │
          │ BullMQ enqueue (email-queue)
          └──────────────────────────────►  apps/worker

  apps/cron :3200 — not shown above; runs @nestjs/schedule jobs on a timer,
  no inbound HTTP/Redis traffic in the request path (health/metrics only).
```

`apps/web` (Angular) never talks tRPC — that layer was removed in the Next.js →
Angular migration (`openspec/changes/archive/2026-08-26-migrate-web-to-angular`).
It calls `apps/api`'s own REST controllers directly and `apps/auth`'s better-auth
HTTP routes directly (via the vanilla `better-auth/client`), both same-origin
through Nginx's `/api/` proxy in production.

---

## Service Ports

Every NestJS app shares the same `globalPrefix: 'api'` (set via `BootstrapUtil.setup`)
— apps are told apart by **port**, not by path prefix. Set in each `apps/*/.env.example`
and read via `ConfigService.getOrThrow<number>('PORT')` in `main.ts`.

| App                  | Port   | Transport                                             |
| --------------------- | ------ | ------------------------------------------------------ |
| `apps/auth`          | `3000` | HTTP (`/api/auth/*`) + Redis microservice             |
| `apps/api`           | `3100` | HTTP (`/api/*` — REST)                                |
| `apps/cron`          | `3200` | HTTP (health/metrics/docs only) — no Redis            |
| `apps/notifications` | `3300` | HTTP (health/metrics/docs only) + Redis microservice  |
| `apps/worker`        | `3400` | HTTP (health/metrics/docs only) + Redis microservice  |
| `apps/web`           | `4200` (dev, `ng serve`) / `8080` (prod, Nginx) | HTTP (Angular static build in prod) |

---

## Infrastructure Dependencies

| Service    | Role                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| PostgreSQL | Primary database — Prisma 7 via `PrismaPg` adapter                                  |
| MongoDB    | Log/audit storage — HTTP request logs, email send logs (30-day TTL)                 |
| Redis      | Microservice transport (NestJS Redis strategy) + BullMQ queues + throttler storage  |
| Prometheus | Scrapes `GET /api/metrics` on all 5 NestJS apps — see [Observability](#observability) |
| Grafana    | Dashboards over the Prometheus datasource — see [Observability](#observability)     |
| Sentry     | Error tracking (optional) — `SentryUtil.init(appName)` in each app's `main.ts`; enabled by setting `SENTRY_DSN` |
| Brevo      | Transactional email delivery                                                        |

---

## Observability

Local-only stack, provisioned by `docker-compose.yaml` (active services — unlike the
per-app service defs and Traefik, which stay commented for future prod use). Full
requirements: `openspec/specs/local-observability-stack/spec.md`.

```
┌───────────────┐   scrape /api/metrics    ┌───────────────────────┐
│  Prometheus    │◄─────────────────────────┤  auth          :3000  │
│  :9090         │◄─────────────────────────┤  api           :3100  │
│  (container)   │◄─────────────────────────┤  cron          :3200  │
│                │◄─────────────────────────┤  notifications :3300  │
│                │◄─────────────────────────┤  worker        :3400  │
└───────┬────────┘   via host.docker.internal └───────────────────────┘
        │ datasource (provisioned)
        ▼
┌───────────────┐
│   Grafana      │
│   :3333        │
└───────────────┘
```

- Scrape config: `docker/prometheus/prometheus.yml` — one `job_name` per app, `metrics_path: /api/metrics`, targets `host.docker.internal:<port>`. Includes a comment for Linux users to add `extra_hosts: ["host.docker.internal:host-gateway"]` to the Prometheus service.
- Grafana datasource: `docker/grafana/provisioning/datasources/prometheus.yaml` — provisions a `Prometheus` datasource pointing at `http://prometheus:9090`, marked `isDefault: true`.
- Every app exposes `GET /api/metrics` via `MetricsController` (`packages/shared/src/metrics/metrics.controller.ts`), guarded by `MetricsAuthGuard` (`packages/shared/src/metrics/metrics-auth.guard.ts`): if `METRICS_TOKEN` is set, requests must send `Authorization: Bearer <token>`; if unset, the endpoint is open (local dev default).

---

## SharedModule — Global Infrastructure

`SharedModule.register(params?)` is `@Global()` and must be the first import in every app `AppModule`. It provides the following to the entire application context:

**Registered imports:**

| Module            | What it provides                                                                |
| ----------------- | ------------------------------------------------------------------------------- |
| `ConfigModule`    | `.env` loading, `isGlobal: true`                                                |
| `DatabaseModule`  | `DatabaseService` (Prisma + PrismaPg)                                           |
| `TerminusModule`  | Health check infrastructure                                                     |
| `MongoModule`     | `MongoService`, `Log` model, `EmailLog` model                                   |
| `LoggerModule`    | pino logger (pretty in dev, JSON in prod)                                       |
| `ThrottlerModule` | Default: 10 req / 60 s per key; Redis storage when `throttlerRedisUrl` supplied |
| `ClsModule`       | Correlation ID propagation via `nestjs-cls`                                     |
| `MetricsModule`   | Prometheus metrics (optional `appName` label)                                   |

**Global providers (applied to all routes):**

| Provider                   | Type              | Role                                                            |
| -------------------------- | ----------------- | --------------------------------------------------------------- |
| `AllExceptionFilter`       | `APP_FILTER`      | Normalised error responses; Sentry capture for 5xx; 422 for Zod |
| `LoggingInterceptor`       | `APP_INTERCEPTOR` | Logs HTTP req/res to MongoDB                                    |
| `CorrelationInterceptor`   | `APP_INTERCEPTOR` | Threads `correlationId` from RPC payloads into CLS              |
| `ZodValidationPipe`        | `APP_PIPE`        | Request body validation                                         |
| `ZodSerializerInterceptor` | `APP_INTERCEPTOR` | Response serialisation                                          |
| `HttpMetricsInterceptor`   | `APP_INTERCEPTOR` | Records HTTP request duration in Prometheus                     |

**Global controller:**

| Controller          | Routes                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `HealthController`  | `GET /api/health/live`, `GET /api/health/ready` (version-neutral)                 |
| `MetricsController` | `GET /api/metrics` (Prometheus scrape endpoint; `MetricsAuthGuard` protected, version-neutral) |

---

## Authentication Flow

```
Client (browser / other service)
    │
    │  Bearer token or better-auth.session_token cookie
    ▼
┌─────────────────────────────────────┐
│  apps/api  — MicroserviceAuthGuard  │  (global APP_GUARD)
└─────────────┬───────────────────────┘
              │  Redis send  MESSAGE_PATTERNS.AUTH_AUTHENTICATE
              ▼
┌─────────────────────────────────────┐
│  apps/auth — AuthController         │
│  @MessagePattern('auth:authenticate')│
│  calls better-auth session lookup   │
└─────────────────────────────────────┘
              │
              │  returns user object (or throws UnauthorizedException)
              ▼
         request.user populated
```

`apps/auth`'s own routes (`/api/auth/*`) are guarded locally by `AuthGuard`
(`@thallesp/nestjs-better-auth`), which checks the session directly against
its own database — no Redis round-trip for `apps/auth`'s own requests.

---

## Event-Driven Flow

### User Created → Welcome Email

```text
1. auth app
   better-auth fires user.created hook
         │
         ▼
   NotificationsPublisher.emit(USER_CREATED, { user })
         │ Redis EVENT_PATTERN
         ▼

2. notifications app
   @EventPattern(USER_CREATED)
   AppController.onUserCreated()
         │
         ▼
   EmailProducer.add(SEND_WELCOME_EMAIL, { to, name })
         │ BullMQ email-queue
         ▼

3. worker app
   @Processor(QUEUES.EMAIL)
   EmailConsumer.process(job) — switch on job.name
     → case JOB_PATTERNS.SEND_WELCOME_EMAIL
         │
         ▼
   MailModule → Brevo API → Email delivered
```

### Supported Events

| Event Pattern                       | Trigger             | Job Enqueued                     |
| ----------------------------------- | ------------------- | -------------------------------- |
| `user:created`                      | New registration    | `SEND_WELCOME_EMAIL`             |
| `user:password_reset_requested`     | Password reset flow | `SEND_PASSWORD_RESET_EMAIL`      |
| `user:password_changed`             | Password changed    | `SEND_PASSWORD_CHANGED_EMAIL`    |
| `user:email_verification_requested` | Email verification  | `SEND_EMAIL_VERIFICATION_EMAIL`  |
| `user:two_factor_enabled`           | 2FA enabled         | `SEND_TWO_FACTOR_ENABLED_EMAIL`  |
| `user:two_factor_disabled`          | 2FA disabled        | `SEND_TWO_FACTOR_DISABLED_EMAIL` |

---

## Frontend-to-Backend Communication

```text
apps/web (Angular)
  injectQuery / injectMutation (@tanstack/angular-query-experimental)
    │  queryFn calls apps/api's REST endpoints or apps/auth's better-auth
    │  routes directly (via authClient), then re-parses the response through
    │  the shared Zod schema from @repo/shared-types before returning it
    ▼
apps/api  (REST HTTP gateway, globalPrefix 'api')
  APP_GUARD: MicroserviceAuthGuard (validates session via apps/auth over Redis)
    └─ plain @Controller()/@Get()/@Post() routes — no tRPC layer

apps/auth (better-auth HTTP routes, globalPrefix 'api')
  APP_GUARD: AuthGuard (@thallesp/nestjs-better-auth)
    └─ /api/auth/* — sign-in, sign-up, session, 2FA, admin
```

There is no `packages/trpc` and no code generation step — REST responses are
validated on the frontend by re-`parse()`ing them through the same Zod schema
the backend used, not by a generated router type. See `CONVENTIONS.md` →
Angular Conventions for the network-boundary parsing pattern.

---

## Correlation IDs

Every request carries a `correlationId` (UUID v4):

1. HTTP: generated in `ClsModule` setup hook; attached to `req[CLS_CORRELATION_ID]`.
2. Microservice events: `BasePublisher.publish()` / `BaseProducer.addJob()` spread `correlationId` into the payload.
3. `CorrelationInterceptor` reads `payload.correlationId` from RPC context and sets it in CLS.
4. All log entries (MongoDB, pino) and Sentry captures include `correlationId`.

---

## Rate Limiting

- `ThrottlerModule` is configured in `SharedModule` with Redis storage (when `throttlerRedisUrl` is provided).
- `CustomThrottlerGuard` keys on `user.id` when authenticated, falls back to client IP.
- `@RateLimit(tier)` combines `@UseGuards(CustomThrottlerGuard)` + `@Throttle(THROTTLE_TIERS[tier])`.
- Tiers defined in `packages/shared/src/constants/throttler.ts`:
  - `default`: 60 req / 60 s
  - `strict`: 10 req / 60 s
- `apps/api AppController` uses `@RateLimit('default')`.

---

## Prisma Schema Structure

Two `.prisma` files merged at generate time:

- `packages/database/prisma/schema.prisma` — generator + datasource (no application models yet; extension point for app-domain models).
- `packages/database/prisma/auth.prisma` — owned by better-auth: `User`, `Session`, `Account`, `Verification`, `TwoFactor`.

Generated client output: `packages/database/generated/prisma/` (CJS format).

---

## Turborepo Task Graph

```
db:generate ──► build ──► dev / test / test:cov / lint / check-types
                      └──► test:integration / test:e2e / test:watch  (cache: false — never skipped)
```

`build` depends on `db:generate` and `^build`, caches `dist/**` (includes `apps/web`'s Angular build output), and takes `.env*` as additional cache-busting inputs.

`test` and `test:cov` run across all workspaces (apps + `packages/shared`, `packages/mail`, `packages/database`). `test:integration` and `test:e2e` depend on `^build`, are never cached, and apply only to apps that have the corresponding jest configs. Run `pnpm test:db:setup` once before executing integration or E2E tasks to ensure the `nestjs_test` database exists and is migrated.
