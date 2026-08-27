---
description: 'Use when creating or modifying NestJS apps or shared packages. Covers module setup, microservices, validation, guards, publishers, consumers, and queue patterns for this monorepo.'
applyTo: 'apps/{auth,notifications,worker}/**/*.ts,packages/{shared,mail,database}/**/*.ts'
---

# NestJS Conventions

## Module Bootstrap

Every NestJS app module **must** import `SharedModule.register()` first. It is `global: true` and provides:

- `ConfigModule` (env vars, `isGlobal: true`, reads `.env`)
- `DatabaseModule` (Prisma via `PrismaPg` adapter)
- `TerminusModule` (health checks)
- `MongoModule` (Mongoose — for logs/audit only)
- `LoggerModule` (nestjs-pino, pino-pretty in dev, JSON in prod)
- `ThrottlerModule` (default: 10 req / 60s per IP)
- `ClsModule` (correlation IDs — auto-set in HTTP middleware + RPC interceptor)
- Global providers: `AllExceptionFilter`, `LoggingInterceptor`, `CorrelationInterceptor`, `ZodValidationPipe`, `ZodSerializerInterceptor`
- Global controller: `HealthController` (`GET /health/live`, `GET /health/ready`)

```typescript
@Module({
  imports: [
    SharedModule.register(),
    // feature modules...
  ],
})
export class AppModule {}
```

## App Bootstrap (`main.ts`)

Use `BootstrapUtil.setup(app, config)` from `@repo/shared` to configure the HTTP server. For microservice apps, attach the Redis transport **before** calling `app.listen()`:

```typescript
import { BootstrapUtil, MicroserviceUtil } from '@repo/shared';

async function bootstrap() {
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
}
```

## Validation

- Use **Zod v4** for all DTOs. Prefer schemas from `@repo/shared-types` when shared with the frontend.
- Create DTO classes with `createZodDto` from `nestjs-zod`.
- Use `z.email()` (not `z.string().email()`). Use `.meta({ id: 'SchemaName' })` for OpenAPI schema IDs.
- `ZodValidationPipe` and `ZodSerializerInterceptor` are registered globally — do not add them manually.

```typescript
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const CreateUserSchema = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    role: z.enum(['admin', 'user']),
  })
  .meta({ id: 'CreateUser' });

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

## Microservices (Redis Transport)

- Service injection tokens come from `SERVICES` in `@repo/shared/constants`.
- Register client microservices via `MicroserviceUtil` helpers from `@repo/shared`:
  - `MicroserviceUtil.registerAuthService()` — registers the auth service client
  - `MicroserviceUtil.registerNotificationsService()` — registers the notifications service client
- Both use `Transport.REDIS`, `retryAttempts: 5`, `retryDelay: 3000`.
- Emit fire-and-forget events with `EventPatterns`; use `MessagePatterns` for request/response.
- **Never use raw string patterns** — always import from `EVENT_PATTERNS` / `MESSAGE_PATTERNS`.

```typescript
import { SERVICES, MicroserviceUtil } from '@repo/shared';

// In module:
ClientsModule.registerAsync([MicroserviceUtil.registerNotificationsService()]);
```

## Publishers (Emitting Events)

To emit Redis events to another service, extend `BasePublisher` from `@repo/shared/abstracts`. The base class handles correlation ID propagation automatically via `ClsService`.

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ClsService } from 'nestjs-cls';
import { BasePublisher, SERVICES, EVENT_PATTERNS } from '@repo/shared';

@Injectable()
export class MyPublisher extends BasePublisher {
  constructor(
    @Inject(SERVICES.NOTIFICATIONS) client: ClientProxy,
    protected clsService: ClsService,
  ) {
    super(client, clsService);
  }

  emitUserCreated(data: UserCreatedInput): void {
    this.publish<UserCreatedInput>(EVENT_PATTERNS.USER_CREATED, data);
  }
}
```

Use the pre-built `NotificationsPublisher` from `@repo/shared/publishers` instead of building a custom one when emitting to the notifications service.

## Queue — BullMQ (`@nestjs/bullmq`)

> **Important**: This project uses `@nestjs/bullmq` (BullMQ). Do not install or import from legacy `bull` / `@nestjs/bull`.

### Registering Queues

```typescript
import { QueueModule, QUEUES } from '@repo/shared';

// In feature module — registers the main queue and its DLQ (`email-queue-dlq`) automatically:
QueueModule.registerQueues([QUEUES.EMAIL]);
```

### Job Producers

Extend `BaseProducer` from `@repo/shared/abstracts`. The base class handles correlation ID injection into job data.

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { BaseProducer, QUEUES, JOB_PATTERNS } from '@repo/shared';

@Injectable()
export class MyProducer extends BaseProducer {
  constructor(@InjectQueue(QUEUES.EMAIL) queue: Queue, clsService: ClsService) {
    super(queue, clsService);
  }

  async queueWelcomeEmail(data: SendWelcomeEmailInput): Promise<void> {
    await this.addJob(JOB_PATTERNS.SEND_WELCOME_EMAIL, data);
  }
}
```

Use the pre-built `EmailProducer` from `@repo/shared/queue` instead of building a custom one for email jobs.

### Job Consumers (Workers)

`@Processor(QUEUES.*)` extends `WorkerHost` with a single `process(job)` method that dispatches on `job.name` via `switch`. DLQ routing happens in `@OnWorkerEvent('failed')`: once `job.attemptsMade >= maxAttempts`, forward it to the DLQ queue.

```typescript
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUES, JOB_PATTERNS, SentryUtil } from '@repo/shared';

@Processor(QUEUES.EMAIL)
export class EmailConsumer extends WorkerHost {
  constructor(@InjectQueue(QUEUES.EMAIL_DLQ) private readonly dlqQueue: Queue) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.SEND_WELCOME_EMAIL:
        return this.sendWelcomeEmail(job as Job<SendWelcomeEmailInput>);
      // ...other JOB_PATTERNS
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    SentryUtil.captureException(error, { extra: { jobId: job.id, jobName: job.name } });

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void this.dlqQueue.add(job.name, job.data, { removeOnComplete: true });
    }
  }
}
```

Default job options (set in `QueueModule`): `attempts: 3`, exponential back-off starting at `2000ms`, `removeOnComplete: true`, `removeOnFail: 500`.

## Authentication

- Auth is handled entirely by `better-auth` via `@thallesp/nestjs-better-auth`.
- `APP_GUARD: AuthGuard` is set globally in the auth app — all routes are protected by default.
- Use `@Public()` decorator (from `@repo/shared/decorators`) to bypass the guard on public routes.
- Use `@CurrentUser()` decorator (from `@repo/shared/decorators`) to extract the authenticated user from `request.user`.
- **Never** implement custom JWT strategies or Passport guards.

```typescript
import { Public, CurrentUser } from '@repo/shared';

@Controller('profile')
export class ProfileController {
  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Public()
  @Get('public-info')
  getPublicInfo() {
    return { info: '...' };
  }
}
```

## Guards

**`MicroserviceAuthGuard`** (in `@repo/shared/guards`) is used for routes that need auth in microservice context. It:

1. Checks `IS_PUBLIC_KEY` reflector metadata (set by `@Public()`)
2. Extracts the bearer token from `Authorization` header or `better-auth.session_token` cookie via `ContextUtil.extractToken()`
3. Sends token to `MESSAGE_PATTERNS.AUTH_AUTHENTICATE` on the auth microservice
4. Attaches the session result to `request.user`

## Configuration

Always use `ConfigService` — never access `process.env` directly in application code (exception: `main.ts` bootstrap only).

```typescript
// ✓ correct
const apiKey = this.configService.getOrThrow<string>('API_KEY');

// ✗ never do this in services/modules
const apiKey = process.env.API_KEY;
```

## Logging

Use `Logger` from `@nestjs/common` (standard NestJS logger — backed by pino):

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  doSomething() {
    this.logger.log('Doing something');
    this.logger.error('Something failed', { context: 'additional data' });
  }
}
```

Correlation IDs are automatically propagated by `ClsModule` — no manual threading needed.

HTTP request/response logs are written to MongoDB automatically by `LoggingInterceptor`. The following paths are silenced: `/health`, `/metrics`, `/favicon.ico`.

## Error Handling

`AllExceptionFilter` is registered globally and handles all uncaught exceptions. It returns:

```json
{
  "statusCode": 500,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/auth/users",
  "message": "Internal server error",
  "correlationId": "abc-123"
}
```

`ZodValidationException` is handled separately with a 422 status. In services, throw NestJS HTTP exceptions:

```typescript
throw new NotFoundException(`User ${id} not found`);
throw new BadRequestException('Invalid input');
throw new InternalServerErrorException('Unexpected error');
```

## Health Checks

`HealthController` is registered globally by `SharedModule`. It exposes:

- `GET /health/live` — always returns 200 (liveness)
- `GET /health/ready` — checks: Prisma DB ping, Redis microservice ping, memory heap < 250MB, disk < 70%

No additional health setup is needed.

## tRPC Integration

Use `TrpcModule.register(filePath, basePath)` from `@repo/shared/trpc` to mount tRPC in an app. Define routers by extending `BaseRouter` and decorating with `@Router()` from `nestjs-trpc-v2`. The `AppRouter` type is auto-generated into `packages/trpc/src/` when not in production.

```typescript
import { Router, Query } from 'nestjs-trpc-v2';
import { BaseRouter } from '@repo/shared';

@Router({ alias: 'users' })
export class UsersRouter extends BaseRouter {
  @Query()
  list() {
    return this.usersService.findAll();
  }
}
```
