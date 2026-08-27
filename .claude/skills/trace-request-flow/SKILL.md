---
name: trace-request-flow
description: Trace the complete lifecycle of an HTTP request or event through the system — from entrypoint to database and back. Produces a step-by-step flow with file references.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Trace a request through this NestJS + Angular monorepo. Follow the code from entry to persistence and back.

**Input**: The argument after `/trace-request-flow` is what to trace. Could be:
- An HTTP route: `POST /api/auth/sign-in/email`
- An event pattern: `user:created`
- A REST endpoint: `GET /api/users/:id`
- A job pattern: `job:send_welcome_email`
- A vague description: "user registration flow"

---

## Trace Phases

### Phase 1: Identify the Entry Point

For HTTP routes:
```bash
grep -r "Controller\|@Get\|@Post\|@Put\|@Delete\|@Patch" apps --include="*.ts" | grep -i "<route-keyword>"
```

For events/messages:
```bash
grep -r "EventPattern\|MessagePattern" apps --include="*.ts" | grep -i "<pattern>"
```

### Phase 2: Trace the Middleware Chain

In NestJS, requests pass through (in order):
1. **Guards** — `AuthGuard` → is user authenticated?
2. **Interceptors** — `LoggingInterceptor`, `CorrelationInterceptor`, `ZodSerializerInterceptor`
3. **Pipes** — `ZodValidationPipe` on DTO parameters
4. **Controller** — route handler
5. **Service** — business logic
6. **Repository/Database** — Prisma or MongoDB

Document each layer with file path and line references.

### Phase 3: Follow Service Calls

```bash
# Find the service
grep -r "constructor.*Service\|inject.*Service" apps/auth/src --include="*.ts"

# Find database calls
grep -r "this\.db\.\|DatabaseService" apps --include="*.ts" | grep -v "import"
```

### Phase 4: Map Side Effects

- Does the handler emit a Redis event? → `grep -r "publish\|emit\|NotificationsPublisher" apps --include="*.ts"`
- Does it enqueue a job? → `grep -r "EmailProducer\|add(" apps --include="*.ts"`
- Does it write to MongoDB? → `grep -r "MongoService\|LogService" apps --include="*.ts"`

### Phase 5: Trace the Response

- What does the controller return?
- Is there a `ZodSerializerInterceptor` shaping the output?
- What HTTP status code is set?

---

## Output Format

Produce a step-by-step trace:

```
REQUEST: POST /api/auth/sign-in/email
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Guard — apps/auth/src/app.module.ts:42
  AuthGuard (APP_GUARD) checks session cookie
  → Route has @Public()? Skip guard.

Step 2: Pipe — packages/shared/src/modules/shared.module.ts
  ZodValidationPipe validates SignInDto
  → Fails? 422 ZodValidationException

Step 3: Controller — apps/auth/src/auth.controller.ts:15
  better-auth handles sign-in via mount handler

Step 4: Service — better-auth engine
  Validates credentials against Prisma User model
  → Invalid? 401 Unauthorized

Step 5: Database — packages/database/prisma/auth.prisma
  SELECT * FROM "user" WHERE email = $1

Step 6: Side effect — apps/auth/src/local-auth.service.ts
  NotificationsPublisher.emit(USER_CREATED, { user })
  → Redis event → apps/notifications

Step 7: Response
  { user, session } → 200 OK
  Cookie: better-auth.session_token set

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL PATH: 7 hops, 2 services, 1 DB query
```

---

## Special Flows

### Event → Queue → Email

```
Event: user:created
  ↓ Redis
notifications/AppController.onUserCreated()
  ↓ Bull job
worker/EmailConsumer.sendWelcomeEmail()
  ↓ Brevo HTTP
Email delivered
```

### REST → Auth validation → DB

```
web (Angular, TanStack Query) → GET /api/users/:id
  ↓ AuthGuard (APP_GUARD)
Redis: auth:authenticate { token }
  ↓
auth/AuthController.authenticate() → returns user
  ↓
UsersController.getUser() → UsersService
  ↓ Prisma
PostgreSQL query
```

---

## Guardrails

- Never modify files — read only
- Always include file path + approximate line number for each step
- Flag missing middleware (e.g., no guard on a sensitive route)
- Note performance considerations (N+1 queries, missing indexes)
