# Corner cases — Deployment / Nginx / Build

## nginx serves `manifest.webmanifest` as `application/octet-stream`

The stock `mime.types` (including the `nginx:1-alpine` image) has no `webmanifest` entry, so the manifest is served as `application/octet-stream`. Chrome still installs from it, but other tooling (Lighthouse, some browsers) expects `application/manifest+json`. Both nginx configs add an exact-match `location = /manifest.webmanifest { default_type application/manifest+json; }` — `default_type` only applies to unmapped extensions, and a `types {}` block must **not** be used instead (inside a server/location it replaces the entire MIME map, turning every `.js`/`.css` into octet-stream).

## The Angular service worker serves `index.html` for `/api/**` navigations

`ngsw`'s default `navigationUrls` is `['/**', '!/**/*.*', ...]`, so a browser **navigation** to `/api/anything` (the address bar, a link, an OAuth redirect) is answered by the service worker with the cached `index.html` instead of reaching nginx. `fetch`/XHR calls are not navigations and are unaffected, which is why this only shows up when someone opens an API URL directly. `apps/web/ngsw-config.json` adds `'!/api/**'`; `src/app/pwa.spec.ts` fails if it is removed. The same file declares no `dataGroups`, so API responses are never cached either.

## `ngsw-worker.js` and `ngsw.json` must not be cached by the web server

If either is served with a long `Cache-Control`/`Expires`, browsers keep the old worker and manifest, so a deploy never reaches users who already have the app. Both nginx configs (`apps/web/nginx.conf.template`, `docs/deploy/nginx/frontend.conf`) have an explicit `no-cache` location **before** the static-extension regex (nginx takes the first matching regex location). In the host config an `add_header` inside a location discards the `server`-level ones, so the security headers are repeated there.

## SPA history fallback can mask a genuinely missing static asset as a 200

**Symptom:** a client-side route (e.g. `/dashboard`) correctly survives a direct navigation or hard reload, but a request for a static asset that no longer exists (e.g. a stale hashed JS chunk referenced by a cached `index.html` after a new deploy) returns `200` with the app shell's HTML instead of a `404` — the failure is silently swallowed instead of surfacing.

**Fix:** a single catch-all `location / { try_files $uri $uri/ /index.html; }` cannot tell "a client-side route with no matching file" apart from "a missing static asset" — both fall through to `index.html`. Split it into two location blocks: one matching known static-asset extensions (`\.(?:js|css|map|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|json|txt)$`) that does `try_files $uri =404;` (never falls back), and the SPA fallback (`try_files $uri /index.html;`) for everything else. See `apps/web/nginx.conf.template` and `docs/deploy/nginx/frontend.conf`. Verified against a real built image: a nested route returns `200` with the app document, a genuinely missing asset returns `404`, and a real hashed chunk still serves `200`.

## `pnpm update-packages` (`ncu -u`) will happily jump to a release candidate or an unsupported major

**Symptom:** running the root `update-packages` script (a bare `npx npm-check-updates -u`, no config) can rewrite `prisma` to a version like `8.0.0-rc.13` — `npm`'s `latest` dist-tag for the `prisma` CLI package currently points at a release candidate even though `@prisma/client`'s `latest` is still on the stable `7.x` line. The same run also proposes `typescript@7.x`, `vitest@5.x`, and `@nestjs/*@12.x`, none of which this stack's other dependencies accept yet.

**Fix:** `.ncurc.json` at the repo root carries a `reject` list (`typescript`, `prisma`, `@prisma/client`, `@nestjs/*`, `ioredis`) that `npm-check-updates` reads automatically — do not remove an entry without re-checking its condition below. Because this repo is a GitHub template repository (consumed by copy, not by git merge), this file travels into every project created from the template along with the script it guards.

Deferred, with the condition that would unblock each:

| Package | Currently blocked at | Blocked by | Unblock when |
| --- | --- | --- | --- |
| `typescript` | `^6.0.3` | `@angular/compiler-cli`/`@angular/build` require `>=6.0 <6.1`; `typescript-eslint` requires `<6.1.0`; `ts-jest` requires `<7`; `@thallesp/nestjs-better-auth` requires `^5.9.2 \|\| ^6.0.0` | Angular and `typescript-eslint` both publish support for TypeScript 7 |
| `prisma` / `@prisma/client` | `^7.10.0` | `npm`'s `latest` dist-tag for the `prisma` CLI serves an 8.0.0 release candidate (`8.0.0-rc.19` as of 2026-09-30); `@prisma/client` has no stable 8.x at all | `@prisma/client` publishes a stable 8.x release |
| `@nestjs/*` (core, common, config, microservices, platform-express, schedule, bullmq, cli, schematics, testing) | `^11.x` | Two dependencies still cap their peer range at NestJS 11: `nestjs-zod@5.5.0` (`@nestjs/common ^10\|\|^11`, `@nestjs/swagger ^7.4.2\|\|^8\|\|^11`) and `@nest-lab/throttler-storage-redis@1.2.0` (`@nestjs/core ^7..^11`). `@sentry/nestjs@11` and `@nestjs/throttler@6.7` already accept NestJS 12 | Both packages above publish a release supporting NestJS 12 |
| `ioredis` | `^5.11.1` | `ioredis@6.0.0` is published, but no formal peer conflict tells us anything: `bullmq@6` takes `ioredis` as a peer and compatibility with a 6.x client has not been investigated | A dedicated investigation confirms `bullmq@6` works with `ioredis@6` |
| `pnpm` (`packageManager`) | `10.33.0` | Not a peer conflict — `ncu` proposes `12.x`, but a package-manager major touches CI, Dockerfiles and the lockfile format; `.ncurc.json` does not reject it, so revert `packageManager` by hand after `ncu -u` | A dedicated change migrates CI, Docker images and the lockfile to pnpm 12 (then add nothing to `reject`) |

See `openspec/changes/update-monorepo-dependencies/design.md` (D5) for the full analysis. `vitest` was unblocked in `update-dependencies-sentry-tracing` once `@angular/build@22.2` accepted `^4 || ^5`.

**Also:** the root `update-packages` script runs `npx npm-check-updates --workspaces --root -u`, so it rewrites the root manifest **and** every `apps/*` / `packages/*` manifest (all read the same `.ncurc.json`). A bare `ncu -u` only touches the root `package.json` — don't drop the flags.

## `node:25+` images ship without `corepack` — `RUN corepack enable` exits 127

**Symptom:** `docker build` of any `apps/*/Dockerfile` on `node:26-alpine` fails at `RUN corepack enable` with `exit code: 127` (command not found). Node 25 removed corepack from the distribution, so it is no longer on the image's `PATH`.

**Fix:** each Dockerfile runs `RUN npm install -g corepack@0.36.0 && corepack enable`, which keeps the root `package.json` `packageManager` as the single source of the pnpm version. The same builds also needed `COPY patches ./patches` (the `nestjs-zod` `patchedDependencies` file) and `packages/testing-utils/package.json` in the manifest list; the stale `packages/trpc` COPY was removed. None of these were exercised by CI, so Dockerfile rot is only caught by building an image: re-run `docker build -f apps/api/Dockerfile --target production .` and `docker build -f apps/web/Dockerfile .` after changing the Node image or the workspace layout. Verified in `update-node-26-dependencies`.

## An app that uses `createZodDto` must declare `nestjs-zod` itself — pnpm does not hoist `packages/shared`'s dependencies

`apps/api` lists `nestjs-zod` as a **direct** dependency, at the same version as `packages/shared` (`^5.5.0`). With pnpm's strict layout an app does not see a package it does not declare, and two copies of `nestjs-zod` mean two `createZodDto` identities and broken Swagger registration. After bumping it, check `require.resolve('nestjs-zod')` returns the same path from the app and from `packages/shared`.

## `pnpm lint` at the root rewrites the NestJS apps' sources

The `lint` script of `apps/api`, `auth`, `notifications`, `worker` and `cron` is `eslint ... --fix`, so the Turborepo `pnpm lint` edits files instead of only checking them, and leaves a dirty working tree that looks like the change's own work. Run `git status` after a root lint and `git checkout --` what you did not mean to touch, or lint without fixing: `pnpm --filter <app> exec eslint <files>`. `apps/web`'s `ng lint --max-warnings 0` does not fix.

## PM2 applies an `env_<name>` block only when `--env <name>` is passed — and the shared env file must not win over `PORT`/`NODE_ENV`

`ecosystem.config.js` defines only `env_production` and `env_qa` blocks, so `pm2 start|reload|restart` **without** `--env` starts the apps with no environment at all (they fail validation at boot). The `Makefile` passes `--env $(ENV)` on every such target; do the same by hand. Inside each block the shared file (`.env.<name>`, falling back to `.env`) is spread **first** and the app's own `NODE_ENV`/`PORT` after it (`appEnv()`): the other order let a `PORT` in the shared file put all five apps on one port. QA runs with `NODE_ENV=production` because `baseEnvSchema.NODE_ENV` accepts only `development | production | test`; the `.env.qa` file is what makes it QA. The file is parsed with `util.parseEnv`, not `dotenv`, which the repo root does not install. Pinned by `scripts/ecosystem-config.test.cjs` (`pnpm test:deploy`); the test writes real `.env*` files, so it cannot run inside a sandbox that blocks reading them.

## An empty optional environment variable is not "absent" — it fails validation

`DEV_EMAIL=` or `SENTRY_DSN=` left empty in a `.env` file parses to the empty string, and `z.email().optional()` / `z.url().optional()` reject `''` (only `undefined` is optional), so the app refuses to boot with an error naming the variable. Omit or comment out an optional variable you do not use; never leave it blank. `DEPLOY-PM2.md` and the `.env.example` files follow this.
