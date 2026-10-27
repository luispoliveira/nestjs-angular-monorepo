# Design

## Context

See proposal.md (Why). Current state that shapes the approach:

- **Node is declared in four places**: `.nvmrc` (`v24.19.0`, read by `actions/setup-node` via `node-version-file`), root `package.json` `engines.node` (`>=22.22.3`), `FROM node:24-alpine` in `apps/{api,auth,notifications,worker,web}/Dockerfile` (two stages each except `web`), and prose in `CLAUDE.md`, `PROJECT_MAP.md`, `CONVENTIONS.md`, `DEPLOY.md`, `DEPLOY-PM2.md`, `.claude/corner-cases/testing.md`. `apps/cron` has no Dockerfile (PM2 only).
- **pnpm is declared twice**: root `packageManager` (Dockerfiles use it through Corepack) and `pnpm/action-setup` `version:` in `.github/workflows/ci.yml`.
- **Metrics**: `packages/shared/src/metrics/metrics.module.ts` registers `@willsoto/nestjs-prometheus` (`PrometheusModule.register` with `defaultMetrics` + `defaultLabels`); `http-metrics.interceptor.ts` and `apps/worker/src/metrics/queue-metrics.service.ts` create `Histogram`/`Counter`/`Gauge` directly from `prom-client`, i.e. on the library's **global default registry**, which is also the one `PrometheusController` serves. `prom-client` is declared in `packages/shared`, `apps/worker` and `apps/cron` (cron has no source import).
- **ioredis** is reached by four paths: the NestJS Redis transport (`apps/auth`, `apps/notifications`, `apps/worker` `main.ts`; `packages/shared` health check), `bullmq` (`apps/worker`, `packages/shared`), `apps/auth`'s own `new Redis(...)` for better-auth rate-limit storage, and `@nest-lab/throttler-storage-redis` in `SharedModule` (peer `ioredis >=5`).
- The `.ncurc.json` `reject` list (`typescript`, `prisma`, `@prisma/client`, `@nestjs/*`, `ioredis`) drives `pnpm update-packages`; the `dependency-upgrade-policy` spec requires each block to state cause and release condition (table in `.claude/corner-cases/deploy-build.md`).

## Goals / Non-Goals

**Goals:**

- The Node runtime change is isolated and verified (clean install + full gate) before any dependency moves, so a Node 26 failure is never confused with a package-bump failure.
- `/metrics` output is byte-for-byte equivalent in names and labels before and after the client swap, apart from metrics the new client adds by default.

**Non-Goals:**

- No change to metric names, buckets, labels, `MetricsAuthGuard` or the `/metrics` route.
- No refactor of how metrics are registered (still the default registry, still module-level/constructor instantiation).

## Decisions

### D1 — Node 26 everywhere, `engines.node: ">=26.0.0"` (root; all apps/packages via the shared lockfile)

`.nvmrc` → `v26.12.1` (latest 26.x at time of writing; take the newest 26.x patch at implementation time). Dockerfiles → `node:26-alpine` (floating minor, as today). `engines` gets a floor only, matching the spec `node-runtime`.
*Alternatives*: `^24.15.0 || >=26` (untested claim, nothing runs 24 — rejected); exact `26.12.x` in engines (forces every patch bump through the manifest — rejected).

### D1b — Dockerfiles install corepack explicitly; stale `packages/trpc` COPY removed (found while applying)

`node:26-alpine` no longer ships `corepack` (removed from Node 25+), so `RUN corepack enable` fails with exit 127 in all five Dockerfiles. Each gets `RUN npm install -g corepack@0.36.0 && corepack enable` (comment updated), keeping the root `packageManager` as the single source of the pnpm version.
*Alternative*: `npm install -g pnpm@10.34.9` — drops corepack but duplicates the pnpm version in five files (rejected).
Also, `apps/{api,auth,notifications,worker}/Dockerfile` carry `COPY packages/trpc/package.json ./packages/trpc/`, a leftover from the removed tRPC package that already breaks `docker build` before this change. It is deleted here because the container verification (tasks 1.3, 5.2) cannot pass without it. Likewise the five Dockerfiles never copied `patches/`, so `pnpm install --frozen-lockfile` fails on `patchedDependencies` (`nestjs-zod@5.5.0.patch`); each gets `COPY patches ./patches` right after the manifest COPY. The four backend Dockerfiles also omit `packages/testing-utils/package.json` from the manifest list, so its `@types/node` is never installed and `@repo/shared`'s build fails (`TS2688`); that COPY is added too.

### D2 — Drift check as a `node --test` script in `scripts/` (root)

Add `scripts/node-version.test.cjs` next to `scripts/ecosystem-config.test.cjs`, using only `node:test`, `node:fs`, `node:assert`: read `.nvmrc` major, the minimum major in `engines.node`, and every `FROM node:<major>` in `apps/*/Dockerfile`; assert all equal, failing with the offending file name. Wire it into the root `test:deploy` script (`node --test scripts/*.test.cjs`) **and** add a step in `ci.yml` that runs only this file (`node --test scripts/node-version.test.cjs`), because `ecosystem-config.test.cjs` writes real `.env*` files and is not meant for CI.
*Alternatives*: a lint rule / Renovate config (new tooling for one check — rejected); no check (the drift we have today, `@types/node` 26 vs runtime 24, shows it happens — rejected).

### D3 — `@types/node` follows the runtime major

Keep `@types/node` on `^26.x` (bumped to the latest 26 patch). No `@types/node` 27 even if published later in this change's life.

### D4 — Patch/minor bumps via the existing routine, with the known coupled sets

Run `pnpm update-packages` (`ncu --workspaces --root -u`, honouring `.ncurc.json`), then hand-fix:

- `packageManager` → `pnpm@10.34.9` (ncu proposes 12.x — revert as before) and `ci.yml` `version: 10.34.9`.
- `bullmq` must resolve to a single version: `apps/worker` (`^6.5.0`) and `packages/shared`'s range must both admit it; check `grep -c "^  bullmq@" pnpm-lock.yaml` = 1.
- `better-auth` and `@better-auth/prisma-adapter` move together (`apps/auth`, `apps/web`); boot `apps/auth` and sign in once (startup schema validation).
- `zod` single copy: `pnpm verify:zod-version`.
- `nestjs-zod` stays at `5.5.0` (its `patchedDependencies` entry in `pnpm-workspace.yaml` must still apply).
- `@willsoto/nestjs-prometheus` is excluded from this step (it is a major — handled in D5).

### D5 — `prom-client` → `@prometheus-io/client` in one atomic step (packages/shared, apps/worker, apps/cron)

`@prometheus-io/client` is `prom-client` republished under a new name with the same API (`Registry`, `Counter`, `Gauge` with `collect()`, `Histogram`, `collectDefaultMetrics`). `@willsoto/nestjs-prometheus@7` peers on `@prometheus-io/client ^0.16.0` and serves that package's default registry.
Therefore the swap is: bump `@willsoto/nestjs-prometheus` to `^7.0.0`, add `@prometheus-io/client` `^0.16.1` to `packages/shared` and `apps/worker`, change the imports (and `jest.mock(...)` targets in the two specs) in the four source/spec files, and **remove `prom-client` from all three manifests in the same commit**. Leaving any `prom-client` import would create metrics on a different default registry and they would silently vanish from `/metrics`.
`apps/cron` declares `prom-client` but never imports it (metrics come from `@repo/shared`, which declares the client itself), so it is removed there, not replaced.
A new spec, `packages/shared/src/metrics/metrics.module.spec.ts`, boots a minimal Nest app with `MetricsModule.register()` and `HttpMetricsInterceptor` on `app.listen(0)` and, using native `fetch` (no new test dependency), asserts one `GET /metrics` contains both a default metric and `http_requests_total` — the registry-split guard required by `prometheus-metrics`.
New default metrics introduced by the client (e.g. `nodejs_eventloop_utilization_*`) are accepted as-is.
*Alternatives*: keep `prom-client` + willsoto 6 (deprecated, frozen — rejected); use `@willsoto` 7 but keep `prom-client` for custom metrics (registry split — rejected).

### D6 — `ioredis@6` is a gated investigation, not a commitment (apps/auth, apps/notifications, apps/worker, packages/shared)

On a throwaway branch state: remove `ioredis` from `.ncurc.json` `reject`, set `^6.0.0` in `apps/auth`, `apps/notifications`, `apps/worker`, install, and require all of:

1. a single `ioredis` version in `pnpm-lock.yaml` (`bullmq` and `@nest-lab/throttler-storage-redis` must resolve the same copy);
2. `pnpm build && pnpm check-types && pnpm test` and `pnpm test:integration` pass;
3. all five backend apps boot and `/health/ready` is 200 (Redis transport ping);
4. one email job flows `api` → Redis event → `notifications` → queue → `worker` and completes;
5. better-auth rate limiting still answers 429 after the limit, and the global throttler still limits a REST route.

**Pass** → keep `^6`, drop `ioredis` from `reject`, delete its row from the deferred table. **Fail** → revert to `^5.11.1`, keep `reject`, and rewrite the table row with the concrete failure as the cause and its fix upstream as the release condition. Either outcome completes the change.

### D7 — Re-checked blockers are written down (`.claude/corner-cases/deploy-build.md`)

Update the deferred table with what was verified on 2026-10-27: `@nestjs/*` (still `nestjs-zod@5.5.0` / `@nest-lab/throttler-storage-redis@1.2.0`; note satellites now publish v12 accepting core 11 — deliberately deferred), `typescript` 7.0.2 (same three blockers), `prisma` `8.0.0-rc.27`, `pnpm` (12.15.0), `ioredis` (per D6). Update the Node-version corner case in `testing.md` to `.nvmrc` `v26.x`.

### Auth / data / API impact

None. No Prisma schema change, no new events, queues, jobs or REST endpoints, no guard or role change.

## Risks / Trade-offs

- [A native module has no Node 26 prebuild and fails to compile on Alpine] → Node bump is its own group with a clean `rm -rf node_modules && pnpm install` and a Docker build of one backend app and `web` before continuing.
- [`ncu` silently raises something past what a peer allows] → `pnpm install` peer warnings are treated as failures for this change; the full gate runs after the bump group.
- [Metric registry split after the client swap] → D5 atomic removal + the `prometheus-metrics` scenario asserting default and custom metrics in one `/metrics` response.
- [Servers deployed with PM2 still on Node 22/24] → BREAKING note in proposal; `DEPLOY-PM2.md` prerequisite updated to Node 26.
- [Node 26 not yet promoted to LTS on the day of implementation] → accepted; promotion is scheduled for late October 2026 and does not change the binaries.

## Migration Plan

1. Developers: `nvm install` (reads `.nvmrc`), then `pnpm install`.
2. CI picks the version from `.nvmrc` automatically.
3. Docker: rebuild images (`node:26-alpine`).
4. PM2 servers: install Node 26 before deploying this release; `pm2 update` after switching Node so the daemon runs on the new runtime.
5. Rollback: revert the merge commit; the lockfile reverts with it.
