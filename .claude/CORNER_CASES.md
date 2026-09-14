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

### better-auth 1.7.3 validates the Prisma schema at startup by default and rejects auth requests on any mismatch

**Symptom:** upgrading from better-auth 1.7.2 to 1.7.3 with no other code change causes every request that touches the `twoFactor()` plugin (and, by extension, most auth flows once that plugin is registered) to fail with `Prisma schema mismatch — Missing columns: twoFactor.verified, twoFactor.failedVerificationCount, twoFactor.lockedUntil`.

**Cause:** these three columns are not new — `@better-auth/core`'s `two-factor/schema.ts` declares them identically in 1.7.2 and 1.7.3 (confirmed by diffing the installed packages), and `auth.prisma`'s `TwoFactor` model never had them. What's new in 1.7.3 is the feature itself: *"Enabled schema validation during initialization by default, including in production, and rejected authentication requests on detected mismatches"* (1.7.3 release notes). 1.7.2 silently tolerated the gap since better-auth marks all three fields `required: false`; 1.7.3 now checks the Prisma client's `_runtimeDataModel` against every registered plugin's expected fields and throws on any that are absent, regardless of whether that field is actually required.

**Fix:** this is a genuine, previously-latent gap, not a reverted feature like the `Account.issuer` case below — add the missing columns. Because all three are optional/defaulted on better-auth's side (`verified: Boolean? @default(true)`, `failedVerificationCount: Int? @default(0)`, `lockedUntil: DateTime?`), this is purely additive: no uniqueness constraint, no NOT NULL, no data rewrite, safe even for a project with existing `twoFactor` rows. **Do not stop at editing `auth.prisma` and regenerating the migration** — see the `pnpm db:generate` / `pnpm build` entry under Database above; skipping the rebuild step reproduces the exact same "missing columns" error even after the database and the schema source are both already correct.

If a future better-auth upgrade reports a similar mismatch for a different plugin, check whether the plugin's own schema definition actually changed between versions (a real new requirement) before assuming it did — as with `Account.issuer`, better-auth sometimes reverts a schema change between versions, and the two failure modes look identical from the error message alone. Diff the installed package's schema source between versions before writing a migration.

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

### `pnpm db:generate` alone is not enough after editing `auth.prisma` — `packages/database` must also be rebuilt

**Symptom:** after editing `packages/database/prisma/auth.prisma` and running `pnpm db:generate`, a Prisma-backed feature (e.g. better-auth's own runtime schema validation, new in 1.7.3 — see the Authentication section) still reports the *old* schema, even though the freshly generated `packages/database/generated/prisma/**/*.ts` source on disk is correct and the live database has the new columns.

**Cause:** Prisma 7's `provider = "prisma-client"` generator (unlike the old `prisma-client-js`) emits TypeScript **source**, not compiled JS, into `generated/prisma/`. `packages/database`'s own package entry point (`dist/src/index.js`, built by `tsc -p tsconfig.build.json`) re-exports from `../generated/prisma/client` — a path resolved *relative to `dist/src/`*, i.e. `dist/generated/prisma/client.js`, a **separately compiled copy** produced by `packages/database`'s own build step, not the `generated/prisma/*.ts` source tree that `prisma generate` just refreshed. `pnpm db:generate` never touches `dist/`; only `pnpm build` (or `pnpm --filter @repo/database build`) does.

**Fix:** always run `pnpm build` for `packages/database` after `pnpm db:generate` whenever `auth.prisma` (or any Prisma schema) changes, before any consumer (`apps/auth`, tests, a running app) can see the new fields. Verify directly if in doubt: `grep -c "<new field name>" packages/database/dist/generated/prisma/internal/class.js` — zero means the compiled copy is stale regardless of what the source or the live database say. This bit twice in the same investigation: first the live-DB reset alone didn't fix a schema-mismatch error from better-auth's new 1.7.3 validation, and only rebuilding `packages/database` did.

### If a future schema correction must reach every template consumer, regenerate `init` — not a currently-applied exception

**Context:** the project rule is "schema changes → new migration, never edit migrations already applied" (see the root `CLAUDE.md`), and it exists to protect *live systems*, where an already-applied migration is a historical record of what actually ran against real data. This repo is a **GitHub template repository**: it is consumed by copy (`Use this template` / `degit`), not by `git merge` or `git pull` from an upstream remote. A project created from the template diverges from it the moment it is created and never receives anything from the template's git history again.

Under that distribution model, an incremental migration added here would reach **zero** consumers: a new project copies whatever `init` looks like on the day it is created, and an already-existing derived project has no git relationship to this repo through which the new migration file could ever arrive.

**Policy, not yet exercised:** if a schema correction is ever needed that applies to *every* future consumer of the template, regenerate the single `20260313155633_init` migration in place instead of adding a second one — that keeps new projects on a one-step history for a schema that is simply correct from the start. This was evaluated concretely for a better-auth account-identity change during the `update-monorepo-dependencies` change and **not applied**: the investigation found better-auth had reverted that schema requirement before the version this workspace upgraded to, so `auth.prisma` needed no correction. See `openspec/changes/update-monorepo-dependencies/design.md` (decisions D1/D2/D4, marked withdrawn) and `proposal.md`'s evidence chain for that specific case, kept for anyone re-deriving the same question later.

**What this would NOT change, if ever exercised:** an already-existing derived project (which has its own independent migration history) still could not receive such a change via a migration file — it never receives one. It would need a documented backfill *procedure* instead.

**Do not** apply this exception to a project that has been created *from* this template and is now itself a live system with real users — at that point the normal rule applies, because the distribution model that would justify the exception (no consumer ever receives the migration) does not hold for it.

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

### `apps/auth`'s `test:integration` couldn't load `@repo/testing-utils` at all — pure-ESM `@faker-js/faker` under a plain CommonJS Jest config

**Symptom:** `pnpm --filter auth test:integration` fails before any test runs: `Must use import to load ES Module: .../@faker-js/faker/dist/index.js`, thrown from `packages/testing-utils/dist/src/factories/user.factory.js`'s `require("@faker-js/faker")`.

**Cause:** `@faker-js/faker` ships `"type": "module"` with no CommonJS build at all (checked directly against its `package.json`). `packages/testing-utils` compiles to CommonJS, so its compiled `user.factory.js` calls `require()` on a package that has no `require`-able entry point — Node throws `ERR_REQUIRE_ESM` regardless of any `transformIgnorePatterns` tweak, because the `.js` file has already been compiled to a static `require()` call; no Jest transform step can retroactively turn that into an `import()`. `apps/auth/test/jest-integration.json` ran plain CommonJS Jest, unlike `jest-e2e.json`, which was already ESM-mode and unaffected. Not caused by any dependency version bump — `@faker-js/faker` was already pinned at `^10.6.0` (pure ESM) before this repo's most recent dependency work; `test:integration` isn't wired into any CI workflow, so nothing had caught it.

**Fix:** converted `apps/auth/test/jest-integration.json` to the same real-ESM Jest setup already used by `jest-e2e.json` (`extensionsToTreatAsEsm: [".ts"]`, `ts-jest` with `useESM: true` and an inline ESNext/bundler tsconfig), and prefixed the `test:integration` script with `NODE_OPTIONS='--experimental-vm-modules'` — under Node ≥24.9 (this repo runs 24.19), Jest's native ESM execution mode can `require(esm)` a CJS module that itself requires a pure-ESM package; plain CJS Jest mode cannot. Doing this surfaced a second, previously-hidden issue in the same file: under real ESM, Jest's globals (`jest.fn()`, etc.) aren't auto-injected — `test/users.integration.ts` needed an explicit `import { jest } from '@jest/globals';`. If another package ever needs a pure-ESM-only dependency under a Jest suite that still runs in CJS mode, converting that suite's config to this same ESM pattern is the fix, not a `transformIgnorePatterns` change.

### `apps/web`'s Angular CLI refuses to run under the shell's default active Node version

**Symptom:** `pnpm --filter web test` (or `build`/`lint`) fails immediately with `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0` even though a correct Node version is installed on the machine — the shell's currently-active `node -v` just isn't one of them (e.g. `v24.14.1`, one patch below the `v24.15.0` floor).

**Fix:** `nvm use` (or check `nvm ls`) against the version pinned in `.nvmrc` (`v24.19.0`) before running any `apps/web` script — it's usually already installed, just not the shell's active version. Also note: `ng test` (Angular 22's `@angular/build:unit-test` Vitest-based builder) does not accept a `-- <spec-file>` filter the way Jest-backed app scripts do (`Option '--' has been specified multiple times` / schema validation error) — run `pnpm --filter web test` for the whole suite; there is no supported single-file shortcut through the package script.
