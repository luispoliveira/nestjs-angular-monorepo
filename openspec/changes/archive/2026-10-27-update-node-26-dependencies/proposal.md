# Proposal

## Why

The workspace pins Node `v24.19.0` while Node 26 (`v26.12.1`) is about to become the next LTS line, and every runtime constraint in the stack (Angular 22.2, Prisma 7/8, Sentry 11, Jest 30, nestjs-pino, `@thallesp/nestjs-better-auth`) already admits it. The pin is also inconsistent today: `@types/node` is on `26.6.x` while the runtime is 24, so the type-checker accepts APIs the runtime may not have, and `engines: ">=22.22.3"` admits Node versions (23.x, 25.x, 24.0–24.14) that the Angular CLI refuses. On top of that, `prom-client` — used by the metrics stack in `packages/shared` and `apps/worker` — is now deprecated and replaced by `@prometheus-io/client`, and `@willsoto/nestjs-prometheus@7` (2026-10-08) has moved to the new client.

## What Changes

- Move the runtime to **Node 26**: `.nvmrc` → `v26.12.1`, `engines.node` → `>=26.0.0`, `node:24-alpine` → `node:26-alpine` in the five Dockerfiles (`apps/{api,auth,notifications,worker,web}`), and update the docs that state a Node version (`CLAUDE.md`, `PROJECT_MAP.md`, `CONVENTIONS.md`, `DEPLOY.md`, `DEPLOY-PM2.md`, `.claude/corner-cases/testing.md`). **BREAKING** for derived projects and servers still on Node 22/24: they must install Node 26.
- Add a check that fails when the Node major in `.nvmrc`, `engines` and the Dockerfiles diverge.
- Bump **pnpm** `10.33.0` → `10.34.9` (`packageManager`, CI `pnpm/action-setup`).
- Bump every dependency with a newer stable release **inside its current major** (~45 packages: Angular 22.2.x, better-auth 1.7.14, bullmq 6.5, Prisma 7.10.1, Sentry 11.9, zod 4.6.7, eslint 10.13, turbo 2.11.10, vitest 5.0.5, `@types/node` 26.6.5, …).
- Replace the deprecated **`prom-client`** with **`@prometheus-io/client`** and upgrade `@willsoto/nestjs-prometheus` `6.1.1` → `7.0.0` in `packages/shared`, `apps/worker` and `apps/cron`. Exposed metric names, labels and the `/metrics` contract stay the same.
- **Investigate `ioredis@6`** against `bullmq@6`, the NestJS Redis transport and better-auth's rate-limit storage. Adopt it only if the investigation passes; otherwise keep `^5` and record why.
- Refresh the deferred-upgrades table in `.claude/corner-cases/deploy-build.md` with the re-checked blockers.

## Non-goals

- NestJS core 12 — still blocked by `nestjs-zod@5.5.0` and `@nest-lab/throttler-storage-redis@1.2.0` (both cap `@nestjs/*` at `^11`).
- The `@nestjs/*` satellites that renumbered to v12 but accept core 11 (`config`, `schedule`, `bullmq`, `terminus`, `mongoose`) — explicitly deferred; `@nestjs/*` stays in `.ncurc.json` `reject`.
- TypeScript 7 — Angular (`>=6.0 <6.1`), `typescript-eslint` (`<6.1.0`) and `ts-jest` (`<7`) still exclude it.
- Prisma 8 — only release candidates are published (`8.0.0-rc.27`); `@prisma/client` latest is `7.10.1`.
- pnpm 12 — touches CI, Docker and the lockfile format; its own change.
- Supporting Node 24 alongside 26 (no CI matrix).

## Open questions

- None blocking. The `ioredis@6` adoption is conditional on the investigation in this change; the condition and both outcomes are defined in design.md, so no behaviour depends on an unanswered question.

## Capabilities

### New Capabilities

- `node-runtime`: the workspace declares one supported Node major, consistently across the version file, the manifest engines and the container images, and refuses to drift.

### Modified Capabilities

- `prometheus-metrics`: default process metrics are provided by `@prometheus-io/client` instead of the deprecated `prom-client`; the requirement names the library.
- `queue-metrics`: the lazily-collected queue-depth gauge uses `@prometheus-io/client`'s `collect()` callback instead of `prom-client`'s.
- `unit-test-infra-shared`: the `HttpMetricsInterceptor` unit tests mock `@prometheus-io/client` instead of `prom-client`.
- `unit-test-coverage-apps`: the worker queue-metrics unit tests mock `@prometheus-io/client` instead of `prom-client`.

## Alternatives considered

- **Stay on Node 24 (`24.22.1`) and downgrade `@types/node` to `^24`** — lowest risk, but defers a line change that every dependency already supports, and Node 24 is leaving Active LTS.
- **Node 26 with `engines: "^24.15.0 || >=26"`** — gentler for derived projects, but nothing (CI, Docker, `.nvmrc`) would exercise Node 24, so the claim would be untested.
- **Keep `prom-client`** — works today, but a deprecated package receives no fixes, and `@willsoto/nestjs-prometheus` has already moved on; staying would pin the module at 6.x.

## Risks & Mitigations

- **Native modules on Node 26** (`sharp`, `lmdb`, `msgpackr-extract`, `esbuild`) — a clean install + full build/test on Node 26 is an explicit gate before any other bump.
- **Split metric registries** — if any file keeps importing `prom-client` while `@willsoto/nestjs-prometheus@7` registers on `@prometheus-io/client`'s default registry, custom metrics silently disappear from `/metrics`. Mitigation: `prom-client` is removed from every manifest in the same step, and a check asserts `/metrics` exposes both default and custom metrics.
- **Known version-split traps** (`bullmq` patch split, better-auth schema validation at startup, two `zod` copies) — bumped together, verified with the existing checks (`grep` lockfile, `pnpm verify:zod-version`, auth sign-in).
- **Derived projects/servers on Node 22/24** — the change is marked BREAKING and the deploy docs state the new requirement.

## Impact

- Root: `.nvmrc`, `package.json` (`engines`, `packageManager`, devDependencies), `pnpm-lock.yaml`, `.ncurc.json` (only if `ioredis` is unblocked), `.github/workflows/ci.yml`, `scripts/`.
- Dockerfiles: `apps/api`, `apps/auth`, `apps/notifications`, `apps/worker`, `apps/web`.
- Code: `packages/shared/src/metrics/*`, `apps/worker/src/metrics/*`; manifests of every `apps/*` and `packages/*`.
- Docs: `CLAUDE.md`, `PROJECT_MAP.md`, `CONVENTIONS.md`, `DEPLOY.md`, `DEPLOY-PM2.md`, `.claude/corner-cases/{testing,deploy-build}.md`.
- No database, auth, REST or event-pattern changes.
