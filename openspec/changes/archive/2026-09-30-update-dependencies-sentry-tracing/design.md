# Design

## Context

- **Load order today** (`apps/*/src/main.ts`): `@nestjs/config`, `@nestjs/core`, `@repo/shared` (its barrel pulls in all of Nest, Prisma, pino, Mongoose, ioredis, bullmq), then `./app.module`, and only then `SentryUtil.init()` inside `bootstrap()`. Sentry v11 instruments modules as they load, so everything is already loaded by the time it initialises.
- **Env loading today**: `.env` (relative to cwd) is loaded by `ConfigModule.forRoot({ envFilePath: '.env' })` in `packages/shared/src/modules/shared.module.ts`. That runs when `AppModule`'s decorator is evaluated, which is *before* `bootstrap()` runs. The current init therefore sees `.env` values by accident; an init placed ahead of every import would not.
- **Module system**: the five Nest apps compile to CommonJS (no `"type": "module"`, `nestjs.json` uses `nodenext`). TypeScript keeps `import` order when it emits `require`, so a first-line `import './instrument'` runs before any other `require`.
- **Launchers**: `nest start` in dev, `node dist/main` in `start:prod`, PM2 `script: ./apps/<app>/dist/main.js` in `ecosystem.config.js`. Keeping the entry file as `main.js` means none of them change.
- **Sentry v11** removed `--require` initialisation and no longer sets up OpenTelemetry. Instrumentation is channel-based and attaches when a module loads. `SentryModule.forRoot()` (from `@sentry/nestjs/setup`) names transactions after Nest routes. Prisma needs no integration option; with the `PrismaPg` adapter the queries run through `pg`, which is instrumented.
- **better-auth 1.7.3 → 1.7.6**: the `twoFactor` and `admin` plugin schemas and the core tables are identical in the published packages. Only the schema-check machinery changed. Its runtime check reads the *compiled* Prisma client (`packages/database/dist`), not the database.

## Goals / Non-Goals

**Goals:**
- Every dependency at its newest stable release that all declared peers admit, plus the four selected majors.
- Automatic Sentry tracing in `api`, `auth`, `notifications`, `worker` and `cron`, opt-in via `SENTRY_TRACES_SAMPLE_RATE`.
- No change to how the apps are launched (dev, prod, PM2, Docker).

**Non-Goals:** see the proposal. In short: no NestJS 12, pnpm 12, TS 7, Prisma 8 or ioredis 6; no cross-service trace propagation; no frontend Sentry.

## Decisions

### D1: Per-app `src/instrument.ts`, imported first from `main.ts`
*Apps: `api`, `auth`, `notifications`, `worker`, `cron`.*

```ts
// apps/api/src/instrument.ts
import { SentryUtil } from '@repo/shared/sentry';
SentryUtil.init('api');
```
```ts
// apps/api/src/main.ts
import './instrument'; // must stay first: Sentry hooks modules as they load
import { ConfigService } from '@nestjs/config';
...
```
The `SentryUtil.init('<app>')` call is removed from `bootstrap()`. This is the approach Sentry documents for NestJS. The alternative, `node --require`, was removed in v11, and `--import` targets ESM. A separate file, rather than inline code at the top of `main.ts`, keeps formatters and import sorters from moving the init below other imports.

### D2: `@repo/shared/sentry` subpath export
*Package: `packages/shared`.*

Importing `SentryUtil` from `@repo/shared` would load the whole barrel, and with it all of Nest, before Sentry initialises, which defeats D1. Add an `exports` entry `"./sentry"` that points at the compiled `dist/utils/sentry.util.js` (types included). `sentry.util.ts` may import only `@sentry/nestjs`, `node:*` built-ins and plain constants files. It stays in the main barrel too, because `AllExceptionFilter` and `EmailConsumer` use `SentryUtil.captureException`.

### D3: `SentryUtil.init` loads `.env` itself with Node's `util.parseEnv`
*Package: `packages/shared`.*

Before it reads `SENTRY_DSN`, `init` reads `.env` (when `existsSync('.env')`) with Node's built-in `util.parseEnv` and assigns only keys not already present in `process.env`, which matches `ConfigModule`'s precedence; a missing file (containers) is a no-op. `process.loadEnvFile` has the same semantics but writes to the host process's env, bypassing Jest's sandboxed `process.env`, so it cannot be unit-tested. When `ConfigModule` later loads the same file there is no conflict, since the values are identical. No new dependency. `main.ts` remains the only place outside `SentryUtil` that reads `process.env`, the same exemption the util already has.

### D4: Sampling via `tracesSampler`, dropping silent paths
*Package: `packages/shared`.*

A plain `tracesSampleRate` is replaced by a `tracesSampler` that:
- returns `0` for `/health`, `/metrics` and `/favicon.ico`;
- otherwise returns `SENTRY_TRACES_SAMPLE_RATE` (default `0`).

`SILENT_PATHS` moves from a local constant in `packages/shared/src/logging/pino.config.ts` to `packages/shared/src/constants/` so that pino and Sentry share one list. The constants files are dependency-free, which keeps D2's constraint. The rate is validated by the existing `base-env.schema.ts` entry (`0..1`). The util parses it defensively (`Number`, clamped, `NaN` → `0`) because it runs before validation.

### D5: Register `SentryModule.forRoot()` in `SharedModule`
*Package: `packages/shared`; takes effect in all Nest apps.*

It goes first in `SharedModule`'s imports, so every app gets route-named transactions without touching its `AppModule`. `SentryGlobalFilter` is **not** added: `AllExceptionFilter` already captures 5xx and RPC errors per the existing spec, and adding the Sentry filter would report the same errors twice.

### D6: Upgrade mechanics
*All workspaces.*

- `pnpm update-packages`. With `vitest` removed from `.ncurc.json` this also raises the majors chosen here and leaves the other rejects alone. Revert `pnpm` in the root `package.json`, since `packageManager`/`pnpm` 12 is out of scope, then run `pnpm install` and `pnpm dedupe` (see the `bullmq` duplicate-copy entry in `CORNER_CASES.md`).
- `zod` goes to `~4.6.5`. The `pnpm-workspace.yaml` override `~4.6.0` already admits it and stays as is.
- `nestjs-zod@5.5.0` has no new version, so `patches/nestjs-zod@5.5.0.patch` stays valid.

### D7: better-auth schema is verified, not assumed
*Packages: `apps/auth`, `packages/database`.*

After the bump, run `pnpm db:generate`, then `pnpm --filter @repo/database build`, and then start `apps/auth` and hit one auth route. better-auth's runtime validation (on by default) rejects requests on any mismatch, and `apps/auth`'s integration tests exercise the same path. `npx auth@latest check schema` is not used: the better-auth config lives inline in `apps/auth/src/app.module.ts` (Nest DI, `ConfigService`), not in a standalone `auth.ts` the CLI can load. Expected result: no change. If a gap is reported, first diff the plugin schema source between versions (as `CORNER_CASES.md` advises), and add a **new** migration only for a real gap. `auth.prisma` is never edited by hand.

## Data model, patterns, auth impact

- **Prisma**: no schema change expected (D7).
- **Events, message patterns, queues, REST endpoints**: none added.
- **Auth/authorization**: none. Guards, roles and better-auth config are unchanged beyond the patch bump.

## Risks / Trade-offs

- **Something imports before `./instrument`.** A later edit or an import-sorter rule could put another import above it and silently disable tracing. Mitigations: the comment on the import line, and a unit test per app asserting that `main.ts`'s first import is `./instrument`, i.e. a line check that is cheap and catches exactly this regression.
- **`.env` and cwd.** It resolves `.env` against cwd, the same as `ConfigModule`, so behaviour matches. Running an app from the repo root would miss its `.env` in both places equally.
- **Span streaming (v11 default).** Traces arrive as streamed segment spans, not `transaction` events. Scope tags do not reach spans, so `SentryUtil.init` also sets `app` as a global-scope *attribute*; the `initialScope` tags stay for error events. Found in the smoke test.
- **Silent paths carry the global prefix.** The real probe paths are `/api/health/*` and `/api/metrics`, because every app sets `globalPrefix: 'api'`. The sampler matches `SILENT_PATHS` at any segment boundary instead of as a leading prefix. pino's exact-match `autoLogging.ignore` has the same latent bug, which predates this change and is left untouched.
- **better-auth routes are named by method only** (`POST`). They are served by better-auth's handler rather than a Nest route, so Sentry has no route template for them; Nest controller routes get one (`GET /api/v1`). The DB spans inside them are still recorded.
- **Startup work is traced too.** With a rate above 0, boot operations (`Create Nest App`, Prisma, Redis and Mongo connects) are sent as their own segments. This is accepted as low-volume noise.
- **No cross-service traces.** A request that fans out over Redis microservices shows as separate, unlinked transactions per service. This is accepted as a non-goal.
- **Vitest `clearMocks: true`** may break a web spec that depends on call history across tests. Fix that spec.
- **Sentry v11 span-attribute renames** (`http.*`, `net.*`) affect only saved Sentry queries or dashboards, not code. Nothing in this repo references them.
