# Proposal

## Why

The workspace is several patch/minor releases behind (better-auth 1.7.6, Angular 22.2, bullmq 6.3.10, …) and a few majors have become adoptable since the last round: `@sentry/nestjs` 11, `nestjs-cls` 7, `dotenv` 18, and `vitest` 5 (now accepted by `@angular/build` 22.2). Sentry v11 also makes an existing defect more visible: every backend app calls `SentryUtil.init()` inside `bootstrap()`, *after* `@nestjs/*`, `@repo/shared` and the whole `AppModule` graph have already been `require`d. Sentry's auto-instrumentation hooks modules as they load, so HTTP/Express/Prisma/Redis/Mongo spans are never produced; only manual `captureException` calls work. `SENTRY_TRACES_SAMPLE_RATE` is already read, but setting it to a non-zero value produces no useful traces today.

## What Changes

- Raise every dependency with a newer stable release that all declared peers admit (patch/minor tier) across `apps/*` and `packages/*`, including `better-auth` / `@better-auth/prisma-adapter` 1.7.3 → 1.7.6.
- Adopt the majors `@sentry/nestjs` 10 → 11 (`packages/shared`), `nestjs-cls` 6 → 7 (`packages/shared`), `dotenv` 17 → 18 (`apps/auth`, `packages/database`), `vitest` 4 → 5 (`apps/web`).
- Lift the `vitest` block from `.ncurc.json`; keep `typescript`, `prisma`, `@prisma/client`, `@nestjs/*`, `ioredis` blocked and refresh each block's stated cause in `.claude/CORNER_CASES.md`.
- Enable Sentry automatic tracing in all five NestJS apps: Sentry initialises from a dedicated instrument entry that is the first module each app loads, reads its env before the Nest `ConfigModule` exists, and registers Sentry's Nest integration so transactions are named after routes/handlers.
- Verify the better-auth schema against the Prisma client instead of assuming it: no migration is expected (plugin and core schemas are byte-identical between 1.7.3 and 1.7.6), but the check is an explicit step.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `sentry-error-tracking`: initialisation moves from "first statement in `bootstrap()`" to "before any other module is loaded"; `tracesSampleRate` comes from `SENTRY_TRACES_SAMPLE_RATE` (default `0`); sampled requests produce automatically-instrumented traces.

## Non-goals

- NestJS 12 — still blocked by `nestjs-zod@5.5.0` and `@nest-lab/throttler-storage-redis@1.2.0` peer ranges.
- pnpm 10 → 12 — touches `packageManager`, CI, Dockerfiles and the lockfile format; separate change.
- TypeScript 7, Prisma 8 (still RC), ioredis 6 (compatibility with bullmq 6 not investigated).
- Distributed trace propagation across the Redis microservice transport or BullMQ jobs — Sentry does not instrument Nest's Redis transport; each service's traces stay independent.
- Frontend (`apps/web`) Sentry / browser tracing.
- Changing the default sample rate: it stays `0`; operators opt in per environment.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| better-auth 1.7.6 runtime schema check rejects auth requests on a mismatch | Rebuild `packages/database` after `db:generate`, then start `apps/auth` and run its integration tests (the runtime check fails fast); migration only if a real gap is reported |
| Moving Sentry init before `ConfigModule` loses `.env` values in dev (DSN silently absent) | Instrument entry loads `.env` itself with Node's built-in `util.parseEnv`, never overriding already-set vars |
| `vitest` 5 enables `clearMocks` by default; a spec relying on mock history across tests breaks | Run `apps/web` tests; fix the specific spec rather than disabling the default |
| Two resolved copies of a bumped package (seen with `bullmq`) break type-checks | `pnpm dedupe` after install, check lockfile for single resolution |
| Tracing overhead in production | Default rate `0`; tracing only runs when an operator sets a rate |

## Alternatives considered

- **`node --require ./instrument.js`** in start scripts / PM2 / Docker — removed in Sentry v11 ("Remove support for initialising via `--require`"); and `--import` targets ESM, while the Nest apps compile to CommonJS. A top-level `import './instrument'` is Sentry's documented Nest path and needs no launcher changes.
- **Keep init in `bootstrap()`** — error capture keeps working but tracing stays broken; rejected since tracing is the goal.
- **`dotenv` in the instrument entry** — works, but `util.parseEnv` is built into Node ≥ 22 (the workspace floor) and avoids a new runtime dependency in five apps.

## Impact

- `apps/{api,auth,notifications,worker,cron}`: new `src/instrument.ts`, `main.ts` first import changes.
- `packages/shared`: `SentryUtil.init` gains env-file loading; new lightweight `@repo/shared/sentry` export (so the instrument entry does not load the Nest-heavy barrel); `SharedModule` registers `SentryModule.forRoot()`; spec update.
- `packages/database`: rebuilt after `db:generate` for the better-auth schema check.
- All `package.json` files, `pnpm-lock.yaml`, `.ncurc.json`, `.claude/CORNER_CASES.md`, `.env.example` comments.
