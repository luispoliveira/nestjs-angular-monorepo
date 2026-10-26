---
paths:
  - "apps/api/**"
  - "apps/auth/**"
  - "apps/notifications/**"
  - "apps/worker/**"
  - "apps/cron/**"
  - "packages/shared/**"
  - "packages/mail/**"
  - "packages/database/**"
---

## NestJS Conventions (`apps/{auth,notifications,worker}`, `packages/{shared,mail,database}`)

### Module bootstrap

Every app `AppModule` **must** import `SharedModule.register()` first. It is `@Global()` and provides:

- `ConfigModule` (`.env`, `isGlobal: true`)
- `DatabaseModule` (Prisma via `PrismaPg`)
- `TerminusModule` (health)
- `MongoModule` (Mongoose — logs/audit only)
- `LoggerModule` (pino, pretty in dev, JSON in prod)
- `ThrottlerModule` (default 10 req / 60s per IP)
- `ClsModule` (correlation IDs)
- Global providers: `AllExceptionFilter`, `LoggingInterceptor`, `CorrelationInterceptor`, `ZodValidationPipe`, `ZodSerializerInterceptor`
- Global controller: `HealthController` exposing `GET /health/live`, `GET /health/ready`

### `main.ts`

The **first** import of every backend `main.ts` is `./instrument` — `src/instrument.ts` calls `SentryUtil.init('<app>')` from the lightweight `@repo/shared/sentry` subpath (never the `@repo/shared` barrel). Sentry hooks modules as they load, so anything imported before it is not traced.

Use `BootstrapUtil.setup(app, config)`. For microservice apps, attach Redis transport **before** `listen()`:

```typescript
import './instrument'; // must stay first
// ...other imports
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.connectMicroservice(MicroserviceUtil.getRedisOptions());
await BootstrapUtil.setup(app, {
  globalPrefix: 'api/my-service',
  useHelmet: true,
  enableVersioning: true,
  swagger: { path: 'docs' },
  cors: { origin: process.env.FRONTEND_URL },
  enableCookieParser: true,
});
await app.startAllMicroservices();
await app.listen(process.env.PORT ?? 3000);
```

`main.ts` is the **only** place where `process.env` may be read directly. Everywhere else: `ConfigService.getOrThrow(...)`.

### Validation (Zod v4)

- Build DTOs with `createZodDto` from `nestjs-zod`.
- Prefer schemas from `@repo/shared-types` when shared with the frontend.
- Use **Zod v4 APIs**: `z.email()` (not `z.string().email()`), `.meta({ id: 'SchemaName' })` for OpenAPI IDs.
- `ZodValidationPipe` + `ZodSerializerInterceptor` are global — do not register them manually.

```typescript
const CreateUserSchema = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    role: z.enum(['admin', 'user']),
  })
  .meta({ id: 'CreateUser' });

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

### Microservices (Redis)

- Inject service clients via `SERVICES` tokens.
- Register clients with `MicroserviceUtil.registerAuthService()` / `MicroserviceUtil.registerNotificationsService()`.
- Defaults: `Transport.REDIS`, `retryAttempts: 5`, `retryDelay: 3000`.
- Fire-and-forget → `@EventPattern(EVENT_PATTERNS.*)`. Request/response → `@MessagePattern(MESSAGE_PATTERNS.*)`.

### Publishers

Extend `BasePublisher` from `@repo/shared/abstracts` — correlation IDs propagate automatically via `ClsService`.

Prefer the pre-built `NotificationsPublisher` from `@repo/shared/publishers` instead of writing a custom one.

### Queues (BullMQ, `@nestjs/bullmq`)

> **Do not** install or import from legacy `bull` / `@nestjs/bull`. This project uses BullMQ.

- Register in feature modules: `QueueModule.registerQueues([QUEUES.EMAIL])`.
- Producers: extend `BaseProducer` (injects correlation ID into job data). Use the pre-built `EmailProducer` from `@repo/shared/queue` for email jobs.
- Consumers: `@Processor(QUEUES.EMAIL)` extending `WorkerHost`, with a single `process(job)` method that dispatches on `job.name` (`JOB_PATTERNS.*`) via `switch`.
- Failure handling: `@OnWorkerEvent('failed')` (reports to Sentry in `EmailConsumer`).
- Default job options: `attempts: 3`, exponential back-off from 2000 ms, `removeOnComplete: true`, `removeOnFail: 500`.

### Authentication

- All routes are protected by default — `APP_GUARD: AuthGuard` is set globally in the auth app.
- Use `@Public()` (from `@repo/shared/decorators`) to bypass.
- Use `@CurrentUser()` to extract `request.user`.
- For routes in microservice context, `MicroserviceAuthGuard` from `@repo/shared/guards` calls `MESSAGE_PATTERNS.AUTH_AUTHENTICATE` to validate the bearer token (header or `better-auth.session_token` cookie). The call is bounded by `AUTH_RPC_TIMEOUT_MS` (5 s): auth rejecting the token → 401, auth silent/unreachable → 503 (never 401, so clients don't sign users out during an outage).
- **Never** add Passport strategies or custom JWT logic.

### Logging & errors

- Use NestJS `Logger` (backed by pino). Correlation IDs are auto-threaded.
- HTTP req/res logs are persisted to MongoDB by `LoggingInterceptor` (probes are skipped: any path containing the segment `/health`, `/metrics` or `/favicon.ico`, under any global prefix and ignoring the query string — same `isSilentPath` rule as pino auto-logging and Sentry sampling).
- Audit trail: writes that matter are recorded in Mongo `audit_events` (separate from the request `Log`, which cannot see better-auth routes or guard rejections). In `apps/api` decorate the handler with `@Audit('<action>', { targetType, fields })`; in `apps/auth` add the path to `AUTH_AUDIT_PATHS`. Actions live in `AUDIT_ACTIONS` (`@repo/shared-types`). Events keep field names only, plus values for `SAFE_CHANGE_FIELDS`; recording is best-effort (never fails the action). `AuditContextGuard` must stay the first global guard in `apps/api`. Retention: `AUDIT_RETENTION_DAYS`.
- `AllExceptionFilter` returns `{ statusCode, timestamp, path, message, correlationId }`. Throw standard `NestJS` HTTP exceptions (`NotFoundException`, `BadRequestException`, …). `ZodValidationException` → 400 with an `errors` array of Zod issues.
