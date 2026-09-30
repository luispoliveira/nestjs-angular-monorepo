# Tasks

## 1. chore: upgrade dependencies

- [x] 1.1 chore(root): remove `vitest` from the `reject` list in `.ncurc.json` (keep `typescript`, `prisma`, `@prisma/client`, `@nestjs/*`, `ioredis`). Verify: `npx npm-check-updates --workspaces --root` lists `vitest ^5` for `apps/web` and no `@nestjs/*`/`typescript`/`prisma` entries.
- [x] 1.2 chore(root): run `pnpm update-packages`, then revert `pnpm`/`packageManager` in root `package.json` to `10.33.0` (pnpm 12 is out of scope), then `pnpm install && pnpm dedupe`. Verify: `git diff` shows `better-auth`/`@better-auth/prisma-adapter` `^1.7.6`, `@sentry/nestjs ^11`, `nestjs-cls ^7`, `dotenv ^18`, `vitest ^5`, `@angular/* ^22.2`; `grep -c "^  bullmq@" pnpm-lock.yaml` is `1`; `pnpm-workspace.yaml`'s `patchedDependencies` still resolves (`nestjs-zod@5.5.0` unchanged).
- [x] 1.3 packages/database + apps/auth: `pnpm db:generate && pnpm --filter @repo/database build`, start `apps/auth` against local Postgres (`pnpm docker:up`) and sign in once. Verify: no better-auth "Prisma schema mismatch" error; `pnpm --filter auth test:integration` passes. If a mismatch is reported, diff the plugin schema between versions first (see `.claude/CORNER_CASES.md`) and add a **new** migration only for a real gap — never edit `auth.prisma` by hand.
- [x] 1.4 all workspaces: `pnpm build && pnpm check-types && pnpm lint && pnpm test`. Fix only upgrade-caused breakage (expected hot spots: `apps/web` specs relying on mock history now that Vitest 5 defaults `clearMocks: true`; any `@sentry/nestjs` type change in `packages/shared/src/utils/sentry.util.ts`). Verify: all four commands exit 0.
- [x] 1.5 docs(root): update the deferred-upgrades table in `.claude/CORNER_CASES.md`: drop the `vitest` row; `@nestjs/*` row now blocked only by `nestjs-zod@5.5.0` and `@nest-lab/throttler-storage-redis@1.2.0` (`@sentry/nestjs@11` and `@nestjs/throttler@6.7` accept Nest 12); `ioredis` row notes 6.0.0 is published, compatibility with bullmq 6 still uninvestigated; `prisma` row cites `8.0.0-rc.19`; add a `pnpm` row (12.x deferred to its own change: `packageManager`, CI, Dockerfiles, lockfile). Verify: each row states cause + unblock condition.
- [x] 1.6 chore: commit group 1 with `/commit` (e.g. `chore(deps): upgrade workspace dependencies`).

## 2. feat(shared): Sentry automatic tracing infrastructure

- [x] 2.1 refactor(shared): move `SILENT_PATHS` from `packages/shared/src/logging/pino.config.ts` to a new `packages/shared/src/constants/` file exported via the constants barrel; `pino.config.ts` imports it. Verify: existing `pino.config` / logging interceptor specs pass unchanged.
- [x] 2.2 feat(shared): in `packages/shared/src/utils/sentry.util.ts`, `init()` loads `.env` via `util.parseEnv` when `existsSync('.env')`, filling only unset keys, replaces `tracesSampleRate` with a `tracesSampler` returning `0` for `SILENT_PATHS` and otherwise the parsed `SENTRY_TRACES_SAMPLE_RATE` (clamped `0..1`, `NaN`/unset → `0`). Imports limited to `@sentry/nestjs`, `node:*` and the constants file (not the barrel).
- [x] 2.3 test(shared): extend `sentry.util.spec.ts`: DSN only in a temp-cwd `.env` → init called with it; process env wins over `.env`; no `.env` → no throw; sampler returns `0` for `/health/live` and `/metrics`, the configured rate for `/api/v1/users`, `0` when unset or invalid. Verify: `pnpm --filter @repo/shared test` passes.
- [x] 2.4 feat(shared): add `"./sentry"` to `packages/shared/package.json` `exports` → `dist/utils/sentry.util.{js,d.ts}`. Verify: after `pnpm --filter @repo/shared build`, `node -e "require('@repo/shared/sentry'); console.log(Object.keys(require.cache).some(k=>k.includes('@nestjs/core')))"` run from `apps/api` prints `false`.
- [x] 2.5 feat(shared): import `SentryModule.forRoot()` (from `@sentry/nestjs/setup`) first in `SharedModule.register()`'s imports; do **not** add `SentryGlobalFilter`. Verify: `shared.module` spec (or a new one) asserts `SentryModule` is among the registered imports; `AllExceptionFilter` specs still pass.
- [x] 2.6 docs(shared): update the NestJS `main.ts` guidance in `CLAUDE.md` and `.github/instructions/nestjs-conventions.instructions.md` to show `import './instrument';` as the first line and `src/instrument.ts`; add a `.claude/CORNER_CASES.md` entry ("Sentry must init before any import; `.env` isn't loaded yet at that point"). Verify: docs reference `@repo/shared/sentry`.
- [x] 2.7 chore: commit group 2 with `/commit` (e.g. `feat(shared): enable sentry automatic tracing`).

## 3. feat(apps): load Sentry before every other module

- [x] 3.1 feat(api,auth,notifications,worker,cron): add `src/instrument.ts` (`import { SentryUtil } from '@repo/shared/sentry'; SentryUtil.init('<app>');`), make `import './instrument';` the first line of each `src/main.ts` with a "must stay first" comment, and remove `SentryUtil.init(...)` from `bootstrap()`. Verify: `pnpm build` passes; `grep -n "SentryUtil.init" apps/*/src/main.ts` is empty.
- [x] 3.2 test(api,auth,notifications,worker,cron): add a small spec per app that reads `src/main.ts` and asserts its first import statement is `./instrument`. Verify: `pnpm test` passes; moving the import down makes the spec fail.
- [x] 3.3 docs(apps): in each backend `.env.example`, comment `SENTRY_TRACES_SAMPLE_RATE` as "0 disables tracing; e.g. 0.1 in production" (fix the duplicated block in `apps/notifications/.env.example`). Verify: one Sentry block per file.
- [x] 3.4 chore: commit group 3 with `/commit` (e.g. `feat(api): init sentry before app modules load`).

## 4. Integration verification

- [x] 4.1 test: tracing smoke — run a throwaway local listener (`node -e` HTTP server on `:9999` logging each envelope's item `type`), start `apps/api` with `SENTRY_DSN=http://public@localhost:9999/1 SENTRY_TRACES_SAMPLE_RATE=1`, call one authenticated route that queries Postgres and `GET /health/live`. Verify: a `transaction` envelope arrives for the route, named after the route template, tagged `app: api`, containing a `db` span; none arrives for `/health/live`. Repeat with `SENTRY_DSN` only in `apps/api/.env` to confirm the `.env` path.
- [x] 4.2 test: regression smoke — with `SENTRY_TRACES_SAMPLE_RATE` unset, trigger a 5xx in `apps/api`: an `event` (error) envelope arrives, no `transaction`; start `worker`, `notifications`, `cron`, `auth` via `pnpm dev` and confirm each boots and `/health/ready` is 200.
