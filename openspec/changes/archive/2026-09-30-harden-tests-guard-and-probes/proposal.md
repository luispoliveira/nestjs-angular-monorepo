# Proposal

## Why

Four independent defects share one theme — the template does something different from what it claims, and each one fails badly in a derived project:

1. `apps/auth`'s integration and E2E suites run `DELETE FROM "user"` against whatever Postgres answers on `localhost:5432/nestjs_test`. A Testcontainers `globalSetup` already exists in `packages/testing-utils/src/e2e/` but no Jest config references it, and it is not exported from the package.
2. `MicroserviceAuthGuard` (`packages/shared`) sends `AUTH_AUTHENTICATE` over Redis with no timeout. With `apps/auth` down, every authenticated request to `apps/api` hangs until the client gives up; and its `catchError` maps *every* failure to 401, so a naive timeout would log users out whenever auth is unavailable.
3. Pino's `autoLogging.ignore` compares `req.url` for exact equality against `SILENT_PATHS`, so `/api/health/live` is never silenced; `LoggingInterceptor` filters nothing and writes every probe to MongoDB. `CLAUDE.md`, `CONVENTIONS.md` and `nestjs-conventions.instructions.md` all say both are silenced.
4. The root `update-packages` script (`npx npm-check-updates -u`) only rewrites the root `package.json`; every `apps/*` and `packages/*` manifest is skipped.

## What Changes

- **BREAKING (dev workflow)**: `apps/auth` `test:integration` and `test:e2e` provision their own ephemeral Postgres, MongoDB and Redis via Testcontainers and never connect to a local database. Docker becomes a prerequisite for these suites; `pnpm test:db:setup`, `scripts/test-db-setup.mjs` and the `DATABASE_URL` in `apps/auth/.env.test` are removed.
- `apps/auth/test/jest.setup.ts` stops overriding container-provided connection variables.
- `apps/auth/test/auth.e2e-spec.ts` mounts routes the way `apps/auth/src/main.ts` does in production (global prefix `api`, no health exclusion).
- `MicroserviceAuthGuard` fails fast: no reply from auth within a fixed timeout → **503 Service Unavailable**; an error returned by auth still → 401.
- One shared path matcher (segment-boundary match on `SILENT_PATHS`) drives Sentry sampling, pino auto-logging, and `LoggingInterceptor` — probes are silenced in all three, under any global prefix and with a query string.
- `update-packages` runs `npm-check-updates` across the root and every workspace, still governed by `.ncurc.json`.

## Capabilities

### New Capabilities

- `microservice-auth-guard`: how `apps/api`'s gateway guard behaves when the auth service is slow, unavailable, or rejects the token.

### Modified Capabilities

- `test-database-setup`: the test database is an ephemeral container per run instead of a pre-provisioned `nestjs_test`; `test:db:setup` and the `.env.test` `DATABASE_URL` requirement are removed.
- `auth-integration-tests`: integration and E2E suites must never reach a non-container database; health scenario uses the production route layout.
- `structured-production-logging`: probe and scrape requests are kept out of stdout HTTP logs and out of the MongoDB request log.
- `dependency-upgrade-policy`: the update routine covers every workspace manifest, not only the root.

## Non-goals

- Running `test:integration` / `test:e2e` in GitHub Actions — deliberately left for a follow-up.
- Test suites for `apps/api`, `apps/cron`, `apps/notifications`, `apps/worker` (they declare `test:e2e` scripts but have no test files).
- Making the guard timeout configurable via env, or adding retries / circuit breaking.
- Blocking the `packageManager` (`pnpm@12`) bump proposed by `ncu`; the existing hand-revert note in `CORNER_CASES.md` stays.

## Risks & Mitigations

- **Docker now required for auth integration/E2E** → documented in README/CONVENTIONS; unit tests (`pnpm test`) remain Docker-free.
- **Slower suite start (containers pulled/started per run)** → one `globalSetup` per Jest run, not per file; alpine images.
- **503 on slow-but-alive auth** → timeout chosen well above normal `AUTH_AUTHENTICATE` latency (single session lookup); value is a named constant, easy to raise.
- **`ncu --workspaces` touching more manifests at once** → same `.ncurc.json` reject list applies; the routine's existing "safe to run unattended" scenario still gates it.

## Alternatives considered

- **Keep local `nestjs_test`, add a guard refusing non-`_test` DB names** — cheaper, but still shares state with the developer's Postgres and still needs `test:db:setup`. Rejected in favour of full isolation.
- **Testcontainers opt-in via env flag** — keeps the original risk as the default. Rejected.
- **Timeout → 401** — simplest, but turns an auth outage into mass logouts in `apps/web`. Rejected.

## Impact

- `packages/testing-utils`: `e2e/global-setup.ts` (adds Redis, exports connection env), `package.json` exports.
- `apps/auth`: `test/jest-integration.json`, `test/jest-e2e.json`, `test/jest.setup.ts`, `test/auth.e2e-spec.ts`, `.env.test`.
- Root: `package.json` (`test:db:setup`, `update-packages`), `scripts/test-db-setup.mjs` (removed).
- `packages/shared`: `guards/microservice-auth.guard.ts`, `constants/observability.ts`, `logging/pino.config.ts`, `interceptors/logging.interceptor.ts`, `utils/sentry.util.ts`.
- `apps/api`: behaviour only (503 on auth outage); no code change.
- Docs: `README.md`, `CONVENTIONS.md`, `ARCHITECTURE_OVERVIEW.md`, `.claude/CORNER_CASES.md`.
