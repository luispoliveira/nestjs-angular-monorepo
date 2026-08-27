# ENTRYPOINTS.md — NestJS + Angular Monorepo

All system entry points: HTTP routes, microservice message/event patterns, BullMQ jobs, and shared health/metrics endpoints.

See also: [PROJECT_MAP.md](PROJECT_MAP.md) | [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) | [CONVENTIONS.md](CONVENTIONS.md)

---

## HTTP Routes

### `apps/auth` — prefix `/api`, port `3000`, versioning enabled

| Method | Path                | Description                                                                               |
| ------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `*`    | `/api/auth/*`       | All better-auth routes (sign-in, sign-up, sign-out, session, OAuth callbacks, 2FA, admin) |
| `GET`  | `/api/health/live`  | Liveness probe                                                                            |
| `GET`  | `/api/health/ready` | Readiness probe (checks DB, Redis)                                                        |
| `GET`  | `/api/metrics`      | `MetricsAuthGuard` — Prometheus scrape endpoint                                          |
| `GET`  | `/api/docs`         | Swagger UI (non-production only)                                                          |

better-auth exposes these sub-routes automatically:

- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/session`
- `GET /api/auth/callback/google` (OAuth)
- `POST /api/auth/two-factor/*`
- `GET/POST /api/auth/admin/*`

### `apps/api` — prefix `/api`, port `3100`, versioning enabled

Plain REST HTTP gateway for `apps/web`'s own backend calls (`globalPrefix: 'api'`).
No tRPC — that layer was removed in the Next.js → Angular migration
(`openspec/changes/archive/2026-08-26-migrate-web-to-angular`).
`MicroserviceAuthGuard` guards routes globally (validates the session over
Redis against `apps/auth`).

| Method | Path                | Description                                   |
| ------ | ------------------- | ---------------------------------------------- |
| `GET`  | `/api/`             | Hello/health route (`AppController.getHello`), `@RateLimit('default')` |
| `GET`  | `/api/health/live`  | Liveness probe                                |
| `GET`  | `/api/health/ready` | Readiness probe                               |
| `GET`  | `/api/metrics`      | `MetricsAuthGuard` — Prometheus scrape endpoint |
| `GET`  | `/api/docs`         | Swagger UI (non-production only)              |

`AppController` (`apps/api/src/app.controller.ts`) is currently the only
application controller — add new REST resources here as the app grows.

### `apps/cron` — prefix `/api`, port `3200`

| Method | Path                | Notes              |
| ------ | ------------------- | ------------------ |
| `GET`  | `/api/health/live`  |                    |
| `GET`  | `/api/health/ready` |                    |
| `GET`  | `/api/metrics`      | `MetricsAuthGuard` |

Swagger: `/api/docs` (non-production only). No business HTTP routes, no Redis
microservice transport — see [Scheduled Jobs](#scheduled-jobs-nestjsschedule) below.

### `apps/notifications` — prefix `/api`, port `3300`

| Method | Path                | Notes              |
| ------ | ------------------- | ------------------ |
| `GET`  | `/api/health/live`  |                    |
| `GET`  | `/api/health/ready` |                    |
| `GET`  | `/api/metrics`      | `MetricsAuthGuard` |

Swagger: `/api/docs` (non-production only).
No application HTTP routes — all traffic is via Redis event patterns.
Apps are distinguished by port, not by path prefix — every app shares the same `/api` prefix.

### `apps/worker` — prefix `/api`, port `3400`

| Method | Path                | Notes              |
| ------ | ------------------- | ------------------ |
| `GET`  | `/api/health/live`  |                    |
| `GET`  | `/api/health/ready` |                    |
| `GET`  | `/api/metrics`      | `MetricsAuthGuard` |

Swagger: `/api/docs` (non-production only).
No application HTTP routes — all traffic is via Redis message patterns and BullMQ.

---

## Redis Message Patterns (`@MessagePattern` — request/response)

Constant source: `packages/shared/src/constants/events.ts`

| Pattern                              | Value                 | Handler App   | Handler                       | Purpose                                     |
| ------------------------------------ | --------------------- | ------------- | ----------------------------- | ------------------------------------------- |
| `MESSAGE_PATTERNS.AUTH_AUTHENTICATE` | `'auth:authenticate'` | `apps/auth`   | `AuthController.authenticate` | Validate session token; returns user object |
| `MESSAGE_PATTERNS.DLQ_LIST`          | `'dlq:list'`          | `apps/worker` | `DlqController.list`          | List jobs in `email-queue-dlq`              |
| `MESSAGE_PATTERNS.DLQ_REPLAY`        | `'dlq:replay'`        | `apps/worker` | `DlqController.replay`        | Move DLQ job back to `email-queue`          |
| `MESSAGE_PATTERNS.DLQ_PURGE`         | `'dlq:purge'`         | `apps/worker` | `DlqController.purge`         | Remove a job from the DLQ                   |

Senders: `MicroserviceAuthGuard` (in `apps/api`) sends `AUTH_AUTHENTICATE`. DLQ patterns are called from `apps/api` or any service that manages the worker.

---

## Redis Event Patterns (`@EventPattern` — fire-and-forget)

Constant source: `packages/shared/src/constants/events.ts`

| Pattern                                            | Value                                 | Emitted by                       | Handled by           | Payload                               |
| -------------------------------------------------- | ------------------------------------- | -------------------------------- | -------------------- | ------------------------------------- |
| `EVENT_PATTERNS.USER_CREATED`                      | `'user:created'`                      | `apps/auth` (`LocalAuthService`) | `apps/notifications` | `{ userId, email }`                   |
| `EVENT_PATTERNS.USER_PASSWORD_RESET_REQUESTED`     | `'user:password_reset_requested'`     | `apps/auth`                      | `apps/notifications` | `{ userId, email, resetToken }`       |
| `EVENT_PATTERNS.USER_PASSWORD_CHANGED`             | `'user:password_changed'`             | `apps/auth`                      | `apps/notifications` | `{ userId, email }`                   |
| `EVENT_PATTERNS.USER_EMAIL_VERIFICATION_REQUESTED` | `'user:email_verification_requested'` | `apps/auth`                      | `apps/notifications` | `{ userId, email, verificationLink }` |
| `EVENT_PATTERNS.USER_TWO_FACTOR_ENABLED`           | `'user:two_factor_enabled'`           | `apps/auth`                      | `apps/notifications` | `{ userId, email }`                   |
| `EVENT_PATTERNS.USER_TWO_FACTOR_DISABLED`          | `'user:two_factor_disabled'`          | `apps/auth`                      | `apps/notifications` | `{ userId, email }`                   |

Publisher: `NotificationsPublisher` in `packages/shared/src/publishers/` — wraps `BasePublisher.publish()` which adds `correlationId`.

---

## BullMQ Queues and Job Patterns

Constant sources: `packages/shared/src/constants/queues.ts`, `packages/shared/src/constants/jobs.ts`

### Queues

| Constant           | Queue Name          | Purpose                                             |
| ------------------ | ------------------- | --------------------------------------------------- |
| `QUEUES.EMAIL`     | `'email-queue'`     | Primary email job queue                             |
| `QUEUES.EMAIL_DLQ` | `'email-queue-dlq'` | Dead Letter Queue — jobs that exhausted all retries |

Default job options (set in `QueueModule`): `attempts: 3`, exponential backoff from 2000 ms, `removeOnComplete: true`, `removeOnFail: 500`.
DLQ job options: `removeOnFail: { count: 1000, age: 2592000 }` (30 days), `removeOnComplete: true`.

### Job Patterns

Constant source: `packages/shared/src/constants/jobs.ts`

| Constant                                      | Value                                  | Enqueued by     | Processed by    | Input schema                           |
| --------------------------------------------- | -------------------------------------- | --------------- | --------------- | -------------------------------------- |
| `JOB_PATTERNS.SEND_WELCOME_EMAIL`             | `'job:send_welcome_email'`             | `EmailProducer` | `EmailConsumer` | `sendWelcomeEmailInputSchema`          |
| `JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL`  | `'job:send_email_verification_email'`  | `EmailProducer` | `EmailConsumer` | `sendEmailVerificationEmailSchema`     |
| `JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL`      | `'job:send_password_reset_email'`      | `EmailProducer` | `EmailConsumer` | `sendPasswordResetEmailInputSchema`    |
| `JOB_PATTERNS.SEND_PASSWORD_CHANGED_EMAIL`    | `'job:send_password_changed_email'`    | `EmailProducer` | `EmailConsumer` | `sendPasswordChangedEmailInputSchema`  |
| `JOB_PATTERNS.SEND_TWO_FACTOR_ENABLED_EMAIL`  | `'job:send_two_factor_enabled_email'`  | `EmailProducer` | `EmailConsumer` | `sendUserTwoFactorEnabledInputSchema`  |
| `JOB_PATTERNS.SEND_TWO_FACTOR_DISABLED_EMAIL` | `'job:send_two_factor_disabled_email'` | `EmailProducer` | `EmailConsumer` | `sendUserTwoFactorDisabledInputSchema` |

All input schemas are in `packages/shared/src/queue/input/` and re-exported from `@repo/shared`.

---

## Scheduled Jobs (`@nestjs/schedule`)

`apps/cron` is the only app registering `ScheduleModule.forRoot()`. Jobs are plain
`@Cron()`-decorated service methods — no Redis or BullMQ involved.

| Job name             | Schedule                       | Timezone        | File                                              |
| --------------------- | -------------------------------- | ----------------- | --------------------------------------------------- |
| `example-heartbeat`  | `CronExpression.EVERY_HOUR`    | `Europe/Lisbon` | `apps/cron/src/example/example-cron.service.ts` |

> `ExampleCronService` is a placeholder — replace with real jobs. It carries a
> `ponytail:` comment: run `apps/cron` single-instance so jobs don't fire once
> per replica; upgrade to a Redis lock or a BullMQ repeatable job for HA scheduling.

---

## Angular Routes (`apps/web`)

No server-side routes — `apps/web` is a static Angular build served by Nginx in
production (proxying `/api/*` to `apps/api`/`apps/auth`) and by `ng serve` in
dev. Client-side route table: `apps/web/src/app/app.routes.ts`.

| Route         | Component                                                          | Guard(s)                  |
| ------------- | -------------------------------------------------------------------- | -------------------------- |
| `/`           | redirects to `/sign-in`                                               | —                          |
| `/sign-in`    | `features/sign-in/sign-in.ts`                                         | `guestGuard`               |
| `/dashboard`  | `features/dashboard/dashboard.ts` (child of `shell/shell.ts`)         | `authGuard`                |
| `/account`    | `features/account/account.ts` (child of `shell/shell.ts`)             | `authGuard`                |
| `/users`      | `features/users/users.ts` (child of `shell/shell.ts`)                 | `authGuard`, `adminGuard`  |
| `/users/:id`  | `features/users/user-detail/user-detail.ts` (child of `shell/shell.ts`) | `authGuard`, `adminGuard`  |

All backend calls happen client-side via `injectQuery`/`injectMutation`
against `apps/api`'s REST endpoints or `apps/auth`'s better-auth routes
(through the vanilla `better-auth/client`) — there is no server-rendering or
API-route proxy layer in `apps/web` itself.

---

## Health Check Details

`HealthController` (registered globally by `SharedModule`) checks:

| Check    | Indicator                               | Threshold                                    |
| -------- | --------------------------------------- | -------------------------------------------- |
| Database | `PrismaHealthIndicator.pingCheck`       | Ping `DatabaseService`                       |
| Redis    | `MicroserviceHealthIndicator.pingCheck` | `Transport.REDIS` at `REDIS_HOST:REDIS_PORT` |
| Memory   | `MemoryHealthIndicator.checkHeap`       | 250 MB heap limit                            |
| Disk     | `DiskHealthIndicator.checkStorage`      | 70% threshold on `/`                         |
