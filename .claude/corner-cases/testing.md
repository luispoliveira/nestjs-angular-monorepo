# Corner cases — Testing

## `apps/auth`'s `test:integration` couldn't load `@repo/testing-utils` at all — pure-ESM `@faker-js/faker` under a plain CommonJS Jest config

**Symptom:** `pnpm --filter auth test:integration` fails before any test runs: `Must use import to load ES Module: .../@faker-js/faker/dist/index.js`, thrown from `packages/testing-utils/dist/src/factories/user.factory.js`'s `require("@faker-js/faker")`.

**Cause:** `@faker-js/faker` ships `"type": "module"` with no CommonJS build at all (checked directly against its `package.json`). `packages/testing-utils` compiles to CommonJS, so its compiled `user.factory.js` calls `require()` on a package that has no `require`-able entry point — Node throws `ERR_REQUIRE_ESM` regardless of any `transformIgnorePatterns` tweak, because the `.js` file has already been compiled to a static `require()` call; no Jest transform step can retroactively turn that into an `import()`. `apps/auth/test/jest-integration.json` ran plain CommonJS Jest, unlike `jest-e2e.json`, which was already ESM-mode and unaffected. Not caused by any dependency version bump — `@faker-js/faker` was already pinned at `^10.6.0` (pure ESM) before this repo's most recent dependency work; `test:integration` isn't wired into any CI workflow, so nothing had caught it.

**Fix:** converted `apps/auth/test/jest-integration.json` to the same real-ESM Jest setup already used by `jest-e2e.json` (`extensionsToTreatAsEsm: [".ts"]`, `ts-jest` with `useESM: true` and an inline ESNext/bundler tsconfig), and prefixed the `test:integration` script with `NODE_OPTIONS='--experimental-vm-modules'` — under Node ≥24.9 (this repo runs 24.19), Jest's native ESM execution mode can `require(esm)` a CJS module that itself requires a pure-ESM package; plain CJS Jest mode cannot. Doing this surfaced a second, previously-hidden issue in the same file: under real ESM, Jest's globals (`jest.fn()`, etc.) aren't auto-injected — `test/users.integration.ts` needed an explicit `import { jest } from '@jest/globals';`. If another package ever needs a pure-ESM-only dependency under a Jest suite that still runs in CJS mode, converting that suite's config to this same ESM pattern is the fix, not a `transformIgnorePatterns` change.

## A suite that imports app source can't use the ESM-mode Jest config — `require(esm)` cycle on `@repo/shared-types`

**Symptom:** `apps/api`'s `test:integration`, copied from `apps/auth`'s ESM config, fails before any test runs: `Cannot require() ES Module .../packages/shared-types/dist/index.js in a cycle`, thrown from `packages/database/dist/src/database.service.js`.

**Cause:** in ESM mode `ts-jest` compiles the app's own `src/` to ESM. A controller that imports both `@repo/shared` (CommonJS, which `require`s `@repo/database` → `@repo/shared-types`) and `@repo/shared-types` (ESM) puts `shared-types` into the ESM graph that is being linked. The CJS `require()` of it then counts as a cycle, and Jest refuses it. `apps/auth`'s integration suite never imports app source, so it never hits this.

**Fix:** keep the suite's **test files in CommonJS** (plain `ts-jest`, no `useESM`/`extensionsToTreatAsEsm`, `tsconfig.test.json`), but **keep `NODE_OPTIONS='--experimental-vm-modules'`** on the script. That flag is what lets Jest `require(esm)` the pure-ESM `@faker-js/faker` from `@repo/testing-utils` (Node ≥24.9). See `apps/api/test/jest-integration.json`. With CJS test files the `jest` global is injected, so do not `import { jest } from '@jest/globals'`.

## `Nest can't resolve ClsService` in an ESM-mode Jest suite — import it from `@repo/shared`

**Symptom:** `apps/auth`'s e2e (ESM Jest) fails at boot with `Nest can't resolve dependencies of the Symbol(AUTH_MODULE_OPTIONS) (…, ?)… ClsService at index [2]`, although the same code runs fine under `pnpm dev`.

**Cause:** `inject: [ClsService]` imported from `nestjs-cls` in the app. Under ESM mode Jest loads the app's own copy of the package as ESM while `@repo/shared`'s CommonJS `dist` loaded another, so the `ClsService` class (the DI token) differs from the one `SharedModule`'s `ClsModule` provides.

**Fix:** `@repo/shared` re-exports `ClsService`; apps import it from there (and do not declare `nestjs-cls` themselves). Same family as the `require(esm)` entry above: anything shared that is also a DI token must come from a single package.

## `jest.setup.ts` `override: true` silently re-points `globalSetup`'s container URLs at localhost

**Symptom:** with Testcontainers wired in via `globalSetup`, the suites still connect to (and `DELETE FROM "user"` in) a Postgres on `localhost:5432`.

**Cause:** Jest runs `globalSetup` first, then each worker runs `setupFiles`. `dotenv.config({ path: '.env.test', override: true })` overwrites `process.env.DATABASE_URL` with whatever `.env.test` holds, and localhost `??` fallbacks fill any gap.

**Fix:** `apps/auth/.env.test` carries no `DATABASE_URL` / `MONGO_URI` / `REDIS_HOST` / `REDIS_PORT`, `jest.setup.ts` has no localhost fallbacks, and it throws when `E2E_CONTAINERS_RUN_ID_ENV` (set by `globalSetup`) is missing — so running Jest with a config that lacks `globalSetup` fails loudly instead of hitting a local database. New apps' suites should follow the same pattern.

## `apps/web`'s Angular CLI refuses to run under the shell's default active Node version

**Symptom:** `pnpm --filter web test` (or `build`/`lint`) fails immediately with `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0` even though a correct Node version is installed on the machine — the shell's currently-active `node -v` just isn't one of them (e.g. `v24.14.1`, one patch below the `v24.15.0` floor).

**Fix:** `nvm use` (or check `nvm ls`) against the version pinned in `.nvmrc` (`v24.19.0`) before running any `apps/web` script — it's usually already installed, just not the shell's active version. Also note: `ng test` (Angular 22's `@angular/build:unit-test` Vitest-based builder) does not accept a `-- <spec-file>` filter the way Jest-backed app scripts do (`Option '--' has been specified multiple times` / schema validation error) — run `pnpm --filter web test` for the whole suite; there is no supported single-file shortcut through the package script.

## A `new Date()` inside a fixture builder makes the spec flaky

Seeding a mock with `row()` and then expecting `row()` builds two different timestamps whenever an async call straddles a millisecond (a CI run failed on 13 ms). Hoist it to a module constant (`const FIXTURE_TIMESTAMP = new Date(...)`). `new Date()` in a test body is fine when asserted with `expect.any(Date)`.

## A DB-level FK to the authenticated user's id needs a real row — `FakeAuthGuard` fakes only the identity

`apps/api/test/fake-auth.guard.ts` gives `request.user` an id such as `test-user`, but there is no `user` row behind it. The first table with a foreign key to the caller's id (`push_subscription.userId`) fails with an FK violation: a 500 mid-handler and orphaned rows. Create the user rows in the suite's `beforeEach` after `truncateDatabase` (see `apps/api/test/push.integration.ts`), and suspect an FK violation before infrastructure when a run behaves oddly.

## `jest` is not a global in `apps/auth`'s e2e suites — they run as native ESM

`test:e2e` runs with `NODE_OPTIONS=--experimental-vm-modules`, and under native ESM Jest does not inject the `jest` object: `jest.fn()` at module level throws a `ReferenceError`, the suite fails to load and Jest reports a failed suite with **no failed test**. `@jest/globals` is not a direct dependency of `apps/auth` and does not resolve under pnpm's strict layout. Record calls with a plain function that pushes to an array (see `apps/auth/test/account-emails.e2e-spec.ts`), and assert on the array. `expect`, `describe` and `it` are still global.
