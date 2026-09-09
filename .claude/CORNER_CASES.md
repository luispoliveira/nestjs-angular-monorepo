# Corner Cases — Living Memory

Accumulated corner cases, gotchas, and non-obvious behaviours discovered during development.
**Always read this file at the start of any task.** Append new findings at the bottom of the relevant section.

---

## Zod v4

<!-- Add Zod-specific surprises here -->

---

## NestJS / SharedModule

<!-- Add NestJS gotchas here -->

---

## Microservices (Redis transport)

<!-- Add microservice edge cases here -->

---

## Authentication (better-auth)

### `BETTER_AUTH_URL` drives the `Secure` cookie prefix, not the proxy headers

**Symptom:** the session cookie is issued without the `Secure` attribute (and without the `__Secure-` name prefix) even though the app sits behind an HTTPS-terminating reverse proxy that correctly forwards `X-Forwarded-Proto: https`.

**Fix:** better-auth derives the `Secure` prefix from `advanced.useSecureCookies`, else from whether `baseURL` (i.e. `BETTER_AUTH_URL`) itself starts with `https://`, else from `isProduction` — **never** from `X-Forwarded-Proto` or any other proxy header. Set `BETTER_AUTH_URL` to the actual public `https://` origin (e.g. `https://auth.example.com/api/auth`); a plain-`http://` or container-internal value here silently drops the `Secure` prefix no matter how the proxy in front of it is configured. Verified against a real `Set-Cookie` header from a running `apps/auth` instance with `BETTER_AUTH_URL=https://…`: `__Secure-better-auth.session_token=…; Secure; SameSite=Lax; Domain=…`.

### `*` means opposite things to `enableCors` and to `trustedOrigins`

**Symptom:** a `CORS_ORIGIN`/origin-allowlist value of `*` looks like it should behave the same way in every place it's consumed, but it doesn't — in one place it silently blocks everything, in the other it silently trusts everything.

**Fix:** `BootstrapUtil`'s `enableCors` (see `packages/shared/src/utils/bootstrap.util.ts`) always calls Nest's `app.enableCors({ origin: [...] })` with an **array** (splitting the comma-joined `CORS_ORIGIN` string) — the `cors` package only pattern-matches when given a function; given an array it does a literal string comparison, so a literal `"*"` entry never equals any real browser `Origin` header and is effectively a no-op that grants nothing. better-auth's `trustedOrigins`, by contrast, treats a bare `*` as a genuine wildcard pattern (`matchesOriginPattern`) that trusts **every** origin. `apps/auth/src/app.module.ts` filters `*` out of the list before it reaches `trustedOrigins` for exactly this reason — do not "simplify" that filter on the assumption the two behave the same.

---

## Queues (BullMQ)

### Every app using `Transport.REDIS` must declare `ioredis` itself

`@nestjs/microservices` never imports `ioredis` statically — it resolves the driver lazily at
runtime (`client/client-redis.js`: `loadPackage('ioredis', ClientRedis.name, () => require('ioredis'))`),
and lists it as a wildcard peer. So a missing `ioredis` passes `pnpm build`, `check-types`, lint and
the whole test suite, then fails at boot with `Cannot find module 'ioredis'`.

`apps/worker` and `apps/notifications` ran for a long time without declaring it: `worker` inherited it
from `bullmq@5`, which pinned `ioredis: 5.10.1` as a hard dependency, and `notifications` got it purely
from pnpm hoisting. **`bullmq@6` moves `ioredis` to a peer dependency** (alongside `redis`, `pg` and
`bullmq-otel`, since v6 supports several Redis drivers), so that transitive copy disappears on upgrade.

Rule: if an app calls `app.connectMicroservice({ transport: Transport.REDIS })`, it declares `ioredis`
in its own `dependencies` — same range across all apps so pnpm resolves a single copy. Verify with
`node -e "require.resolve('ioredis')"` run **from the app's own directory**, not from the repo root;
hoisting at the root hides exactly the failure a pruned deploy reproduces.

### Bumping `bullmq`'s patch version in `apps/worker` alone can split the resolved version in two, breaking the build with a structural-typing error

**Symptom:** after bumping only `apps/worker/package.json`'s `bullmq` (e.g. `^6.3.1 → ^6.3.4`) and running a plain `pnpm install`, `pnpm build` fails in `apps/worker` with a TS2345 error whose message is a wall of near-identical `Queue<...>` generic types, bottoming out in `Property 'libName' is protected but type '...' is not a class derived from '...'`. The two types look identical but come from two different install paths in `node_modules/.pnpm/` — one `bullmq@6.3.4`, one `bullmq@6.3.1`.

**Cause:** `@nestjs/bullmq`'s peer range for `bullmq` (`^3 || ^4 || ^5 || ^6`) and `packages/shared`'s peer range (`^5.66.5 || ^6.0.0`) are both wide enough to admit the new version, but a plain `pnpm install` after editing only one `package.json` does not always force pnpm to re-resolve every peer-dependency combination against the new version — it can leave a stale `bullmq@6.3.1` resolution wired into `@nestjs/bullmq`'s peer context alongside the freshly-bumped `bullmq@6.3.4` used directly by `apps/worker`. TypeScript then sees two structurally-similar-but-distinct `Queue` classes and refuses the assignment.

**Fix:** run `pnpm dedupe` after bumping a package that multiple workspaces depend on (directly or via a peer range) — it collapses the two resolutions back to one (`grep -n "^  bullmq@" pnpm-lock.yaml` should show exactly one entry). A plain `pnpm install` is not guaranteed to do this on its own. If a build error names a "duplicate" class assignable to its own definition, suspect two resolved copies of the same package before suspecting an actual breaking API change.

---

## Database (Prisma / PrismaPg)

<!-- Add Prisma / DB corner cases here -->

### This template's `init` migration is regenerated in place, not extended — a deliberate exception to "never edit an applied migration"

**Context:** the project rule is "schema changes → new migration, never edit migrations already applied" (see the root `CLAUDE.md`), and it exists to protect *live systems*, where an already-applied migration is a historical record of what actually ran against real data. This repo is a **GitHub template repository**: it is consumed by copy (`Use this template` / `degit`), not by `git merge` or `git pull` from an upstream remote. A project created from the template diverges from it the moment it is created and never receives anything from the template's git history again.

Under that distribution model, an incremental migration added here (e.g. `add_account_issuer`) would reach **zero** consumers: a new project copies whatever `init` looks like on the day it is created, and an already-existing derived project has no git relationship to this repo through which the new migration file could ever arrive.

**Decision:** when a schema correction applies to *every* future consumer of the template (such as aligning `auth.prisma`'s `Account` model with the identity scheme better-auth's installed version actually uses), regenerate the single `20260313155633_init` migration in place instead of adding a second one. This keeps new projects on a one-step history for a schema that is simply correct from the start.

**What this does NOT change:** an already-existing derived project (which has its own independent migration history) still cannot apply this change via a migration file — it never receives one. It needs a documented backfill *procedure* instead (see `openspec/changes/update-monorepo-dependencies/design.md`, decision D4, for the better-auth account-identity example: add the column nullable, backfill by account type, verify no duplicate keys, then add the `NOT NULL` and the unique index).

**Do not** generalize this exception to a project that has been created *from* this template and is now itself a live system with real users — at that point the normal rule applies again, because the distribution model that justifies the exception (no consumer ever receives the migration) no longer holds.

---

## Angular

<!-- Add Angular edge cases here -->

---

## Deployment / Nginx

### SPA history fallback can mask a genuinely missing static asset as a 200

**Symptom:** a client-side route (e.g. `/dashboard`) correctly survives a direct navigation or hard reload, but a request for a static asset that no longer exists (e.g. a stale hashed JS chunk referenced by a cached `index.html` after a new deploy) returns `200` with the app shell's HTML instead of a `404` — the failure is silently swallowed instead of surfacing.

**Fix:** a single catch-all `location / { try_files $uri $uri/ /index.html; }` cannot tell "a client-side route with no matching file" apart from "a missing static asset" — both fall through to `index.html`. Split it into two location blocks: one matching known static-asset extensions (`\.(?:js|css|map|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|json|txt)$`) that does `try_files $uri =404;` (never falls back), and the SPA fallback (`try_files $uri /index.html;`) for everything else. See `apps/web/nginx.conf.template` and `docs/deploy/nginx/frontend.conf`. Verified against a real built image: a nested route returns `200` with the app document, a genuinely missing asset returns `404`, and a real hashed chunk still serves `200`.

---

## Build / Turborepo / pnpm

<!-- Add build-system gotchas here -->

### `pnpm update-packages` (`ncu -u`) will happily jump to a release candidate or an unsupported major

**Symptom:** running the root `update-packages` script (a bare `npx npm-check-updates -u`, no config) can rewrite `prisma` to a version like `8.0.0-rc.13` — `npm`'s `latest` dist-tag for the `prisma` CLI package currently points at a release candidate even though `@prisma/client`'s `latest` is still on the stable `7.x` line. The same run also proposes `typescript@7.x`, `vitest@5.x`, and `@nestjs/*@12.x`, none of which this stack's other dependencies accept yet.

**Fix:** `.ncurc.json` at the repo root carries a `reject` list (`typescript`, `prisma`, `@prisma/client`, `vitest`, `@nestjs/*`, `ioredis`) that `npm-check-updates` reads automatically — do not remove an entry without re-checking its condition below. Because this repo is a GitHub template repository (consumed by copy, not by git merge), this file travels into every project created from the template along with the script it guards.

Deferred, with the condition that would unblock each:

| Package | Currently blocked at | Blocked by | Unblock when |
| --- | --- | --- | --- |
| `typescript` | `^6.0.3` | `@angular/compiler-cli`/`@angular/build` require `>=6.0 <6.1`; `typescript-eslint` requires `<6.1.0`; `ts-jest` requires `<7`; `@thallesp/nestjs-better-auth` requires `^5.9.2 \|\| ^6.0.0` | Angular and `typescript-eslint` both publish support for TypeScript 7 |
| `prisma` / `@prisma/client` | `^7.10.0` | `npm`'s `latest` dist-tag for the `prisma` CLI serves an 8.0.0 release candidate; `@prisma/client` has no stable 8.x at all | `@prisma/client` publishes a stable 8.x release |
| `vitest` | `^4.0.8` | `@angular/build@22.1.7` declares a peer of `vitest ^4.0.8` | `@angular/build` widens its peer range to accept Vitest 5 |
| `@nestjs/*` (core, common, config, microservices, platform-express, schedule, bullmq, cli, schematics, testing) | `^11.x` | Four dependencies cap their peer range at NestJS 11: `nestjs-zod@5.5.0` (`@nestjs/common ^10\|\|^11`, `@nestjs/swagger ^7.4.2\|\|^8\|\|^11`), `@sentry/nestjs@10.74.0` (`@nestjs/core ^8..^11`), `@nestjs/throttler@6.5.0` (`@nestjs/core ^7..^11`), `@nest-lab/throttler-storage-redis@1.2.0` (`@nestjs/core ^7..^11`) | All four of the packages above publish a release supporting NestJS 12 — they track the same major, so they are likely to clear around the same time, turning this into one coordinated upgrade rather than four separate ones |
| `ioredis` | `^5.11.1` | No formal peer conflict, but `bullmq` bundles its own `ioredis` and a major-version split between the two has not been investigated | A dedicated investigation confirms compatibility with `bullmq`'s bundled `ioredis` |

See `openspec/changes/update-monorepo-dependencies/design.md` (D5) for the full analysis.

---

## Testing

### `apps/web`'s Angular CLI refuses to run under the shell's default active Node version

**Symptom:** `pnpm --filter web test` (or `build`/`lint`) fails immediately with `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0` even though a correct Node version is installed on the machine — the shell's currently-active `node -v` just isn't one of them (e.g. `v24.14.1`, one patch below the `v24.15.0` floor).

**Fix:** `nvm use` (or check `nvm ls`) against the version pinned in `.nvmrc` (`v24.19.0`) before running any `apps/web` script — it's usually already installed, just not the shell's active version. Also note: `ng test` (Angular 22's `@angular/build:unit-test` Vitest-based builder) does not accept a `-- <spec-file>` filter the way Jest-backed app scripts do (`Option '--' has been specified multiple times` / schema validation error) — run `pnpm --filter web test` for the whole suite; there is no supported single-file shortcut through the package script.
