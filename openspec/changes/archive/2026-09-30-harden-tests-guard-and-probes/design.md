# Design

## Context

See proposal.md — Why. Facts that shape the approach:

- `packages/testing-utils/src/e2e/global-setup.ts` already starts `postgres:17-alpine` + `mongo:6.0`, runs `pnpm --filter @repo/database db:migrate:deploy` against the container, and writes `DATABASE_URL` / `MONGO_URI` to `process.env`; `global-teardown.ts` removes containers by label. Neither is referenced by any Jest config, and `package.json` `exports` only exposes `.`.
- Jest runs `globalSetup` in the parent process; workers inherit its `process.env`. Then each worker runs `setupFiles` — `apps/auth/test/jest.setup.ts` calls `dotenv.config({ path: '.env.test', override: true })`, which today re-points `DATABASE_URL` at `localhost:5432/nestjs_test`, and then fills `??` fallbacks to localhost URLs.
- `apps/auth`'s `AppModule` registers the notifications Redis client and the `/health/ready` Redis ping, so the E2E suite needs a Redis too. `globalSetup` does not start one.
- `MicroserviceAuthGuard` is the **only** request/response (`ClientProxy.send`) call in the codebase, used as `APP_GUARD` in `apps/api` only. `apps/auth`'s `AUTH_AUTHENTICATE` handler rejects every bad token with `RpcException({ status: 401, message: 'Unauthorized' })`, including unexpected errors from `getSession`.
- `sentry.util.ts` already has a segment-boundary matcher (`isSilentPath`) over `SILENT_PATHS`; `pino.config.ts` uses `SILENT_PATHS.includes(req.url)`; `LoggingInterceptor` has no filter.
- `npm-check-updates` supports pnpm workspaces (`--workspaces --root`) and reads the root `.ncurc.json` for every manifest.

## Goals / Non-Goals

**Goals:**
- Make it structurally impossible for the auth suites to reach a non-container database.
- One path-silencing rule, one place, three consumers.

**Non-Goals:**
- Sharing containers between `test:integration` and `test:e2e` runs (each Jest invocation provisions its own).
- Container reuse across runs (`withReuse`) — would reintroduce shared state.

## Decisions

### D1 — Wire the existing `globalSetup` into both auth Jest configs (`packages/testing-utils`, `apps/auth`)

Add subpath exports `./e2e/global-setup` and `./e2e/global-teardown` to `packages/testing-utils/package.json` (pointing at `dist/src/e2e/*.js`), and set `globalSetup` / `globalTeardown` in `apps/auth/test/jest-integration.json` and `jest-e2e.json` to those module names.
*Alternative:* a hard-coded `<rootDir>/node_modules/@repo/testing-utils/dist/...` path — works, but bypasses the package boundary. Fall back to it only if Jest's resolver rejects the subpath export.

The integration suite gets Mongo and Redis containers it does not use. Accepted: one setup for both suites beats a second, parameterised one (a few seconds of startup).

### D2 — Add Redis to `globalSetup`

`redis:7-alpine` via `GenericContainer`, same run label; export `REDIS_HOST` / `REDIS_PORT` from the mapped port. Makes E2E independent of `pnpm docker:up`.

### D3 — `jest.setup.ts` can no longer point at a local database

- Delete `DATABASE_URL`, `MONGO_URI`, `REDIS_HOST`, `REDIS_PORT` from `apps/auth/.env.test`, so `override: true` has nothing to clobber. Keep `override: true` for the remaining keys (it must still beat `apps/auth/.env` values already in the environment).
- Remove the localhost `??` fallbacks for those four variables.
- Fail fast: if `process.env[E2E_CONTAINERS_RUN_ID_ENV]` is unset, throw with a message saying the suites must run through the configured `globalSetup` (covers someone invoking Jest with a different config). `E2E_CONTAINERS_RUN_ID_ENV` is exported from `@repo/testing-utils`.

*Alternative:* keep the fallbacks but refuse any host other than the container's. Rejected — more code than simply not having a fallback.

### D4 — E2E mounts routes like production (`apps/auth/test/auth.e2e-spec.ts`)

Use `globalPrefix: 'api'` with no health exclusion, matching `apps/auth/src/main.ts`; health probe at `/api/health/live`. Better-auth still owns `/api/auth/*`, so the protected-route paths are unchanged. Drop the stale "mirror production" comment.

### D5 — Guard: bounded wait, classify by the auth contract (`packages/shared`)

- New constant `AUTH_RPC_TIMEOUT_MS = 5000` in `packages/shared/src/constants/` (exported with the others). Not env-driven (proposal non-goal).
- Pipe `timeout(AUTH_RPC_TIMEOUT_MS)` after `send()`.
- `catchError`: the auth service's only rejection shape is `{ status: 401, ... }`. If `err?.status === 401` → `UnauthorizedException`; **anything else** (rxjs `TimeoutError`, Redis connection error, unexpected payload) → `ServiceUnavailableException('Authentication service unavailable')`, logged at `error`.
  *Alternative:* special-case `TimeoutError` only and keep 401 for the rest — a Redis outage would still log users out. Rejected.
- Auth impact: no change to which routes are protected or to `@Public()` / roles; only the failure status changes. `AllExceptionFilter` already renders 503 with the correlation ID. `apps/web` has no status-specific handling today (session state comes from better-auth, not from `apps/api` responses), so a 503 surfaces as an ordinary failed query.

### D6 — Single silent-path matcher (`packages/shared`)

Move `isSilentPath(path)` from `utils/sentry.util.ts` to `constants/observability.ts` next to `SILENT_PATHS`, and make it strip the query string itself (`path.split('?')[0]`). Consumers:
- `sentry.util.ts` — imports it (behaviour unchanged).
- `pino.config.ts` — `autoLogging.ignore: (req) => isSilentPath(req.url ?? '')`.
- `LoggingInterceptor` — if `isSilentPath(request.url)`, `return next.handle()` before creating the Mongo log.

`sentry.util.ts` is imported via the lightweight `@repo/shared/sentry` subpath before anything else loads; `constants/observability.ts` has no imports, so the move keeps that path dependency-free.

### D7 — `update-packages` covers workspaces (root `package.json`)

`"update-packages": "npx npm-check-updates --workspaces --root -u"`. `.ncurc.json` unchanged. Update the "Also:" note in `.claude/CORNER_CASES.md` to say the script now does this.

### D8 — Remove `test:db:setup`

Delete `scripts/test-db-setup.mjs` and the root `test:db:setup` script; update `CONVENTIONS.md` (line ~248), `ARCHITECTURE_OVERVIEW.md` (line ~301) and README to say "Docker required; containers are provisioned per run".

## Risks / Trade-offs

- [Jest resolver may not honour the subpath `exports` for `globalSetup`] → fallback path in D1; verified by running both suites.
- [`globalSetup` failure leaves containers behind] → Testcontainers' Ryuk reaper removes labelled containers when the parent process exits; teardown already tolerates that.
- [5 s may be too short on a cold auth instance] → a single session lookup is ms-scale; the constant is one line to raise.
- [Classifying by `status === 401` couples the guard to the auth handler's error shape] → that shape is internal to this repo and both sides are covered by unit tests (guard spec asserts 401 vs 503).
- [`ncu --workspaces` proposes `pnpm@12` for `packageManager`] → unchanged from today; hand-revert per `CORNER_CASES.md`.

## Migration Plan

Developer-facing only: after pulling, `pnpm test:db:setup` no longer exists; ensure Docker is running before `pnpm test:integration` / `pnpm test:e2e`. The old `nestjs_test` database can be dropped. Rollback = revert the change; nothing persistent is migrated.
