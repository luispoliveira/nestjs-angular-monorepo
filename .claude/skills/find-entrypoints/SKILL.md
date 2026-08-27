---
name: find-entrypoints
description: Find and list all system entry points — HTTP routes, microservice patterns, queue jobs, health endpoints, and CLI commands. Produces a complete inventory with file references.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Discover all entry points in this NestJS + Angular monorepo. Produce a complete, navigable inventory.

**Do not modify anything.** This is a read-only discovery skill.

---

## Discovery Steps

### 1. HTTP Routes (NestJS)

```bash
# Find all controller decorators
grep -r "@Controller\|@Get\|@Post\|@Put\|@Delete\|@Patch" apps --include="*.ts" -n
```

For each controller, extract:
- HTTP method and path
- Auth requirement (`@Public()` present? or protected by default)
- DTO used for validation
- Service called

### 2. better-auth Routes

The auth app mounts all better-auth routes at `/api/auth/*`. Enumerate:
- Sign-in, sign-up, sign-out
- Session endpoints
- OAuth callbacks (Google)
- 2FA endpoints
- Admin endpoints

```bash
grep -r "betterAuth\|plugins\|socialProviders" apps/auth --include="*.ts" -n
```

### 3. Microservice Patterns

```bash
# Message patterns (request/response)
grep -r "@MessagePattern" apps --include="*.ts" -n

# Event patterns (fire-and-forget)
grep -r "@EventPattern" apps --include="*.ts" -n
```

Cross-reference with constants:
```bash
cat packages/shared/src/constants/events.ts
```

### 4. Queue Jobs

```bash
# Processors
grep -r "@Processor\|@Process" apps --include="*.ts" -n
```

Cross-reference with:
```bash
cat packages/shared/src/constants/jobs.ts
```

### 5. Health Endpoints

Provided globally by `SharedModule` via `HealthController`:
- `GET /health/live` — always returns 200 if process is running
- `GET /health/ready` — checks DB, Redis, MongoDB connectivity

```bash
find packages/shared/src -name "health.controller.ts" | xargs cat
```

### 6. Angular Routes

```bash
# Route table
cat apps/web/src/app/app.routes.ts

# Lazy-loaded feature components
find apps/web/src/app/features -maxdepth 1 -type d | sort
```

For each route, note:
- Path and lazy-loaded component
- Guard applied (`authGuard`, `guestGuard`, `adminGuard`)?

---

## Output Format

```
## Entry Point Inventory

### HTTP — apps/auth (port 3001, prefix: /api/auth)

| Method | Path | Auth | File |
|--------|------|------|------|
| * | /api/auth/* | Public | better-auth (all routes) |
| GET | /api/auth/health/live | Public | shared/health.controller.ts |
| GET | /api/auth/health/ready | Public | shared/health.controller.ts |
| GET | /api/auth/docs | Public (non-prod) | main.ts (Swagger) |

### HTTP — apps/api (REST gateway)

| Method | Path | Auth | File |
|--------|------|------|------|
| GET | /api/users | Required | apps/api/src/... |

### Microservice — Redis

| Pattern | Type | Handler | File |
|---------|------|---------|------|
| auth:authenticate | message | AuthController.authenticate | apps/auth/src/auth.controller.ts:15 |
| user:created | event | AppController.onUserCreated | apps/notifications/src/app.controller.ts:... |

### Queue Jobs — Bull (email-queue)

| Job | Handler | File |
|-----|---------|------|
| job:send_welcome_email | EmailConsumer.sendWelcomeEmail | apps/worker/src/consumer/email.consumer.ts |

### Angular Routes — apps/web (dev port 4200)

| Path | Guard | Component | File |
|------|-------|-----------|------|
| / | — (redirect) | — | apps/web/src/app/app.routes.ts |
| /sign-in | guestGuard | SignIn | apps/web/src/app/features/sign-in/sign-in.ts |
| /dashboard | authGuard | Dashboard | apps/web/src/app/features/dashboard/dashboard.ts |
```

---

## Reference Documents

- `ENTRYPOINTS.md` — existing entry point docs (compare and offer to update if stale)
- `CLAUDE.md` — conventions for route patterns

---

## Guardrails

- Never modify files — read only
- Flag any entry points missing in `ENTRYPOINTS.md`
- Note any unprotected routes that should require auth
- Offer to update `ENTRYPOINTS.md` if significant gaps found
