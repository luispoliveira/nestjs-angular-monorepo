# Corner Cases — Living Memory

Accumulated corner cases, gotchas, and non-obvious behaviours discovered during development.
**Always read this file at the start of any task.** Append new findings at the bottom of the relevant section.

---

## Zod v4

<!-- Add Zod-specific surprises here -->

---

## NestJS / SharedModule

<!-- Add NestJS gotchas here -->

### Sentry tracing silently records nothing unless Sentry initialises before every other import

**Symptom:** errors reach Sentry, but with `SENTRY_TRACES_SAMPLE_RATE` above 0 no HTTP/Postgres/Redis spans ever appear.

**Cause:** Sentry (v11 is channel-based, earlier majors used OpenTelemetry) instruments a module *when it loads*. Calling `SentryUtil.init()` inside `bootstrap()` is too late: by then `main.ts`'s own imports (`@nestjs/*`, the `@repo/shared` barrel, `./app.module`) have already loaded the whole graph. `node --require ./instrument` is no longer an option either, because v11 dropped it.

**Fix:** each app's `src/instrument.ts` is the first import of `main.ts` and loads `SentryUtil` from the `@repo/shared/sentry` subpath, which pulls in neither Nest nor the barrel. Two follow-on gotchas:
- **`.env` is not loaded yet.** `ConfigModule` only loads `.env` when `AppModule` is evaluated, so `SentryUtil.init` reads `.env` itself with `util.parseEnv`; process env wins.
- **Do not use `process.loadEnvFile` here.** It writes to the host process's env, which Jest's sandboxed `process.env` never sees, so it cannot be unit-tested.

Each app has a spec asserting that `./instrument` stays the first import.

Two more things surfaced while smoke-testing against a fake ingest endpoint:
- **Tags no longer reach spans.** Sentry v11 streams spans by default (envelope items of type `span`, not `transaction`), and streamed spans carry only attributes. `initialScope.tags` still tag error events, but the `app` label on traces needs `Sentry.getGlobalScope().setAttributes({ app })`.
- **Probe paths include the prefix.** Every app sets `globalPrefix: 'api'`, so the real paths are `/api/health/*` and `/api/metrics`. The Sentry sampler matches `SILENT_PATHS` at segment boundaries. pino's `autoLogging.ignore` compares exactly and therefore never matches: probes are still logged.

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

### better-auth routes run outside Nest: no CLS, no interceptors, and an after hook that throws replaces the response

**Symptom:** audit events recorded from a better-auth hook had no `correlationId`, `/sign-out` events had no actor, and the Mongo request `Log` has no `/api/auth/*` entries at all.

**Cause:** `@thallesp/nestjs-better-auth` mounts the handler with `httpAdapter.use(...)`, i.e. raw Express, ahead of Nest's middleware chain. So (1) the global CLS middleware never runs for those routes, and `ClsService.get()` has no store; (2) interceptors and guards never see them; (3) better-auth clears the session during `/sign-out`, so by the time an after hook runs `ctx.context.session` is gone; (4) better-auth runs after hooks on failures too (`ctx.context.returned` is the `APIError`) and an `APIError` thrown from an after hook **replaces the real response**.

**Fix:** `apps/auth/src/audit/`: pass the module's `middleware` option (`withCorrelationId(cls)`) to wrap the handler in a CLS context; a `@BeforeHook('/sign-out')` looks the session up first and stashes it on `ctx.context.auditSession`; and `AuthAuditHook.onAfter` wraps everything in try/catch and never throws. Detect a failed request by shape (`Error` with a numeric `statusCode`), not `instanceof`, so unit tests need not load the ESM better-auth package.

### `*` means opposite things to `enableCors` and to `trustedOrigins`

**Symptom:** a `CORS_ORIGIN`/origin-allowlist value of `*` looks like it should behave the same way in every place it's consumed, but it doesn't — in one place it silently blocks everything, in the other it silently trusts everything.

**Fix:** `BootstrapUtil`'s `enableCors` (see `packages/shared/src/utils/bootstrap.util.ts`) always calls Nest's `app.enableCors({ origin: [...] })` with an **array** (splitting the comma-joined `CORS_ORIGIN` string) — the `cors` package only pattern-matches when given a function; given an array it does a literal string comparison, so a literal `"*"` entry never equals any real browser `Origin` header and is effectively a no-op that grants nothing. better-auth's `trustedOrigins`, by contrast, treats a bare `*` as a genuine wildcard pattern (`matchesOriginPattern`) that trusts **every** origin. `apps/auth/src/app.module.ts` filters `*` out of the list before it reaches `trustedOrigins` for exactly this reason — do not "simplify" that filter on the assumption the two behave the same.

### `admin.createUser` sends no verification email — invitations go through `requestPasswordReset`

better-auth's `/admin/create-user` creates the user with `emailVerified: false` and, when no `password` is passed, **no credential account**, and it never calls `sendVerificationEmail`. Under `requireEmailVerification: true` such an account cannot sign in until something verifies it. The invitation is `auth.api.requestPasswordReset({ body: { email, redirectTo } })` from `databaseHooks.user.create.after`, gated on `context?.path === '/admin/create-user'`: `resetPassword` _creates_ the credential account when none exists, and `sendResetPassword` tells an invitation from a reset by whether that credential account exists. The hook can find the user because `databaseHooks.*.after` run after the creating transaction commits. `auth` must be bound to a `const` before the options object closes over it (see `apps/auth/src/app.module.ts`). `redirectTo` is origin-checked only for requests that come through HTTP; a server-side `auth.api` call has no request, so the check is skipped.

### `onPasswordReset` receives the user as loaded _before_ the reset

`resetPassword` loads the user, writes the new password, then calls `onPasswordReset({ user })` with that earlier row — and never touches `emailVerified`. So `user.emailVerified === false` inside the hook means "this password set is the account's activation"; the hook marks the email verified itself (following the emailed link proves ownership of the address). Don't key activation on `afterEmailVerification`: it also fires at the end of an email _change_.

### `@AfterHook` handlers also run for refused requests

`@thallesp/nestjs-better-auth`'s `@AfterHook('/change-password')` fires even when better-auth refused the change (wrong current password), and the caller's session is still valid, so a "password changed" email would go out for a password that did not change. `LocalAuthService.isRefused(ctx)` (`ctx.context.returned instanceof Error`) makes every notifying hook return early. Detect by `instanceof Error`, not by importing better-auth's `APIError` (ESM-only, which the CommonJS unit suite cannot load). A hook must also never _throw_ on a refused request: an `APIError` thrown from an after hook replaces the real response.

### `apps/auth` e2e suites must run in band

Every auth e2e file calls `truncateDatabase` in `afterAll` against the one Testcontainers Postgres. Run in parallel, the first file to finish wipes the other's users and sessions mid-run and its authenticated requests start failing with 401. `test:e2e` passes `--runInBand`.

### The global throttler does not cover `/api/auth/*` — better-auth limits itself

`SharedModule` registers `ThrottlerModule` but no global `APP_GUARD` for it, so Nest rate limiting is opt-in per route via `@RateLimit()`. better-auth serves `/api/auth/*` with its own handler, outside the Nest guard pipeline, so `@RateLimit()` can never reach sign-in. better-auth's own limiter is production-only and in-memory by default (per worker), which left dev with no login throttle at all. `apps/auth` therefore sets `betterAuth({ rateLimit })` explicitly: enabled everywhere but `test` (the e2e suites hammer sign-in), strict `customRules` on `/sign-in/email`, `/sign-up/email`, `/two-factor/verify-*`, `/request-password-reset`, `/reset-password`, backed by a shared-Redis `customStorage` (`rate-limit.storage.ts`: atomic Lua `INCR`+`EXPIRE`, fails open if Redis is down). In better-auth 1.7.6 a refused request is a `429` carrying `X-Retry-After` (not `Retry-After`), and `/forget-password` no longer exists — only `/request-password-reset`.

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

### Bull Board can't replay a DLQ job: DLQ jobs sit in `waiting` in a queue nobody consumes

**Symptom:** the dashboard shows `email-queue-dlq` jobs but offers no retry for them; and a retry on the failed original in `email-queue` sends the email a second time.

**Cause:** `EmailConsumer` copies a permanently failed job into `email-queue-dlq` with `dlqQueue.add(job.name, job.data)`, so it is a fresh `waiting` job in a queue with no `@Processor`, while the failed original also stays in `email-queue` (`removeOnFail: 500`). Bull Board's retry only re-runs a `failed` job inside its own queue.

**Fix:** replay is `BaseDlqService.replay()` (`DLQ_REPLAY` message pattern), which re-adds the job to the original queue and removes it from the DLQ. The dashboard is therefore mounted with `readOnlyMode: true` on both queues (`apps/worker/src/bull-board/`).

### Bull Board is a mounted Express app: under the global prefix by default, outside guards, interceptors and CLS

**Symptom:** with `globalPrefix: 'api'` the dashboard answers at `/api/admin/queues`, not `/admin/queues`; `@UseGuards`/`@Audit` have no effect on it; and the 401/403/503 bodies it returns have no `correlationId` and a `path` like `/api/queues` instead of the full URL.

**Cause:** `@bull-board/nestjs` mounts the board's router through `MiddlewareConsumer.forRoutes(route)`, which Nest prefixes like any route. It is not a controller, so guards and interceptors never run. `ClsModule`'s middleware is mounted on `'*'` _under_ the prefix, so a route excluded from the prefix gets no CLS store; and Express strips the mount point from `request.url`, which is what `AllExceptionFilter` reports as `path`.

**Fix:** serve it at `/admin/queues` with `globalPrefixExclude: ['admin/queues']` (`workerBootstrapConfig`), and gate it with Bull Board's own `middleware` option: Nest runs it through its exception filters, so it can simply `throw` `UnauthorizedException` / `ForbiddenException` / `ServiceUnavailableException`. Pass a function, not a class: a class is resolved in `BullBoardRootModule`'s scope, which cannot see `SERVICES.AUTH`; build it in `forRootAsync`'s `useFactory`.

### Bull Board's `forFeature` instantiates the adapter class itself — formatters need a subclass, and `readOnlyMode` answers 405

**Symptom:** `adapter.setFormatter('data', …)` has nowhere to be called, because `forFeature({ name, adapter, options })` takes the adapter _class_ and `options` has no formatter slot.

**Fix:** a `BullMQAdapter` subclass that calls `this.setFormatter(...)` in its constructor (`RedactingBullMQAdapter`). Note `readOnlyMode` is enforced server-side — every queue-scoped write route returns **405** (`ERRORS.QUEUE_READ_ONLY`) through `queueProvider`; the global pause-all/resume-all answer 200 but skip read-only queues. `apps/worker/test/bull-board.integration.ts` lists every write route of the installed version and fails if an upgrade adds one that isn't covered.

---

## Database (Prisma / PrismaPg)

<!-- Add Prisma / DB corner cases here -->

### Partial unique indexes must be declared in the schema (`partialIndexes` preview), never hand-written into a migration

**Context:** `Customer.taxIdHash` has to be unique only among non-deleted rows (`WHERE "deletedAt" IS NULL`).

**Gotcha:** if you hand-write a `CREATE UNIQUE INDEX ... WHERE ...` into a migration's SQL, the Prisma schema doesn't know the index exists. The next `prisma migrate dev` detects drift and generates a `DROP INDEX` for it.

**Fix:** since Prisma 7.4, enable `previewFeatures = ["partialIndexes"]` on the generator and declare `@@unique([taxIdHash], where: { deletedAt: null })`. The generated migration contains the `WHERE ("deletedAt" IS NULL)` clause, and `migrate dev --create-only` then produces an empty migration, which confirms there is no drift. This is a preview feature: if it is ever removed, fall back to raw SQL **and** expect to re-apply it after every drift-triggered regeneration. Columns are camelCase here (no field `@map`), so a `raw(...)` predicate must quote `"deletedAt"`.

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

### The seeder can hit `ECONNREFUSED` on a cold boot, on a healthy Postgres

**Symptom:** an app that seeds on boot occasionally crashes at startup with `ECONNREFUSED` from its own seeder even though Postgres is up.

**Cause:** the `PrismaPg` driver adapter can refuse the very first query issued right after `$connect()` resolves (a connection-pool race; root cause unconfirmed).

**Fix:** `DatabaseSeederService.onModuleInit` wraps the run in `withRetry` (3 attempts, `attempt × 500 ms` back-off, a warning per failed attempt, the last error rethrown). Because the whole sequence is retried, every step added to `seed()` **must be idempotent** (find-or-skip on a natural key).

### `PushSubscription` adds a relation to better-auth's `User` model in `auth.prisma`

`auth.prisma` is owned by better-auth, but Prisma needs the back-relation field on `User` (`pushSubscriptions PushSubscription[]`) for `PushSubscription.user` to compile. That one field is the only edit this template makes to `auth.prisma` (it carries a comment saying so). It is not a column — the table gets its FK from the `push_subscription` migration — so better-auth never sees it. If `auth.prisma` is ever regenerated from better-auth's CLI, **re-add that line** or `prisma generate` fails with "missing the opposite relation field". The FK is `ON DELETE CASCADE`, so deleting a user deletes their subscriptions. After touching `auth.prisma`, rebuild `packages/database` (see the `db:generate` entry above).

### `prisma migrate dev` cannot run non-interactively — diff the schema instead

Without a database to hand (CI, a sandbox), generate the SQL with `prisma migrate diff --from-schema <old schema dir> --to-schema ./prisma --script`, save the old `prisma/` files first, and write the output to `prisma/migrations/<timestamp>_<name>/migration.sql`. It is the same SQL `migrate dev` would write; confirm it by running `pnpm db:migrate` once against a real database.

---

## Angular

<!-- Add Angular edge cases here -->

### `ngsw-worker.js` only shows a push wrapped in `notification` — and opens its URL only through `data.onActionClick`

The Angular service worker does **not** show an arbitrary Web Push payload. It shows one only when the JSON payload is `{ "notification": { title, body, icon, tag, renotify, data } }` — a flat `{ title, body }` is silently ignored (no notification, no error). A click opens nothing by default: the target has to be declared as `data.onActionClick.default = { operation: 'navigateLastFocusedOrOpen', url }`, which focuses an open tab or opens one. `PushConsumer.ngswPayload` (`apps/worker`) builds exactly this and `push.consumer.spec.ts` pins the shape; a plain `web-push` payload written by hand will "send" with a 201 and show nothing. Also: the service worker is registered only in **production** builds, so push can never be tried under `ng serve` — build with `pnpm --filter web build` and serve `dist/web/browser` (over HTTPS or `localhost`) to test on a device.

### `<mat-dialog-content class="flex …">` silently renders as `display: block`

**Symptom:** dialog form fields sit side by side in narrow inline rows (and overflow the dialog) instead of stacking, even though `<mat-dialog-content>` has `flex flex-col gap-2`.

**Cause:** Material's `.mat-mdc-dialog-content { display: block }` is injected **unlayered**, while Tailwind v4 utilities live in `@layer utilities`. Unlayered CSS beats any layered rule regardless of specificity, so `.flex` loses, and the `inline-flex` `mat-form-field`s flow inline. `flex-col`/`gap-*` still compute, but they do nothing on a block container. This affected every dialog in `apps/web`.

**Fix:** a global unlayered `.mat-mdc-dialog-content.flex { display: flex; }` in `apps/web/src/styles.scss` (specificity 0,2,0 beats Material's 0,1,0 regardless of injection order). When a Tailwind utility "does nothing" on a Material element, check the computed style for an unlayered Material rule before adding more classes.

---

## Deployment / Nginx

### nginx serves `manifest.webmanifest` as `application/octet-stream`

The stock `mime.types` (including the `nginx:1-alpine` image) has no `webmanifest` entry, so the manifest is served as `application/octet-stream`. Chrome still installs from it, but other tooling (Lighthouse, some browsers) expects `application/manifest+json`. Both nginx configs add an exact-match `location = /manifest.webmanifest { default_type application/manifest+json; }` — `default_type` only applies to unmapped extensions, and a `types {}` block must **not** be used instead (inside a server/location it replaces the entire MIME map, turning every `.js`/`.css` into octet-stream).

### The Angular service worker serves `index.html` for `/api/**` navigations

`ngsw`'s default `navigationUrls` is `['/**', '!/**/*.*', ...]`, so a browser **navigation** to `/api/anything` (the address bar, a link, an OAuth redirect) is answered by the service worker with the cached `index.html` instead of reaching nginx. `fetch`/XHR calls are not navigations and are unaffected, which is why this only shows up when someone opens an API URL directly. `apps/web/ngsw-config.json` adds `'!/api/**'`; `src/app/pwa.spec.ts` fails if it is removed. The same file declares no `dataGroups`, so API responses are never cached either.

### `ngsw-worker.js` and `ngsw.json` must not be cached by the web server

If either is served with a long `Cache-Control`/`Expires`, browsers keep the old worker and manifest, so a deploy never reaches users who already have the app. Both nginx configs (`apps/web/nginx.conf.template`, `docs/deploy/nginx/frontend.conf`) have an explicit `no-cache` location **before** the static-extension regex (nginx takes the first matching regex location). In the host config an `add_header` inside a location discards the `server`-level ones, so the security headers are repeated there.

### SPA history fallback can mask a genuinely missing static asset as a 200

**Symptom:** a client-side route (e.g. `/dashboard`) correctly survives a direct navigation or hard reload, but a request for a static asset that no longer exists (e.g. a stale hashed JS chunk referenced by a cached `index.html` after a new deploy) returns `200` with the app shell's HTML instead of a `404` — the failure is silently swallowed instead of surfacing.

**Fix:** a single catch-all `location / { try_files $uri $uri/ /index.html; }` cannot tell "a client-side route with no matching file" apart from "a missing static asset" — both fall through to `index.html`. Split it into two location blocks: one matching known static-asset extensions (`\.(?:js|css|map|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|json|txt)$`) that does `try_files $uri =404;` (never falls back), and the SPA fallback (`try_files $uri /index.html;`) for everything else. See `apps/web/nginx.conf.template` and `docs/deploy/nginx/frontend.conf`. Verified against a real built image: a nested route returns `200` with the app document, a genuinely missing asset returns `404`, and a real hashed chunk still serves `200`.

---

## Build / Turborepo / pnpm

<!-- Add build-system gotchas here -->

### `pnpm update-packages` (`ncu -u`) will happily jump to a release candidate or an unsupported major

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

---

## Testing

### `apps/auth`'s `test:integration` couldn't load `@repo/testing-utils` at all — pure-ESM `@faker-js/faker` under a plain CommonJS Jest config

**Symptom:** `pnpm --filter auth test:integration` fails before any test runs: `Must use import to load ES Module: .../@faker-js/faker/dist/index.js`, thrown from `packages/testing-utils/dist/src/factories/user.factory.js`'s `require("@faker-js/faker")`.

**Cause:** `@faker-js/faker` ships `"type": "module"` with no CommonJS build at all (checked directly against its `package.json`). `packages/testing-utils` compiles to CommonJS, so its compiled `user.factory.js` calls `require()` on a package that has no `require`-able entry point — Node throws `ERR_REQUIRE_ESM` regardless of any `transformIgnorePatterns` tweak, because the `.js` file has already been compiled to a static `require()` call; no Jest transform step can retroactively turn that into an `import()`. `apps/auth/test/jest-integration.json` ran plain CommonJS Jest, unlike `jest-e2e.json`, which was already ESM-mode and unaffected. Not caused by any dependency version bump — `@faker-js/faker` was already pinned at `^10.6.0` (pure ESM) before this repo's most recent dependency work; `test:integration` isn't wired into any CI workflow, so nothing had caught it.

**Fix:** converted `apps/auth/test/jest-integration.json` to the same real-ESM Jest setup already used by `jest-e2e.json` (`extensionsToTreatAsEsm: [".ts"]`, `ts-jest` with `useESM: true` and an inline ESNext/bundler tsconfig), and prefixed the `test:integration` script with `NODE_OPTIONS='--experimental-vm-modules'` — under Node ≥24.9 (this repo runs 24.19), Jest's native ESM execution mode can `require(esm)` a CJS module that itself requires a pure-ESM package; plain CJS Jest mode cannot. Doing this surfaced a second, previously-hidden issue in the same file: under real ESM, Jest's globals (`jest.fn()`, etc.) aren't auto-injected — `test/users.integration.ts` needed an explicit `import { jest } from '@jest/globals';`. If another package ever needs a pure-ESM-only dependency under a Jest suite that still runs in CJS mode, converting that suite's config to this same ESM pattern is the fix, not a `transformIgnorePatterns` change.

### A suite that imports app source can't use the ESM-mode Jest config — `require(esm)` cycle on `@repo/shared-types`

**Symptom:** `apps/api`'s `test:integration`, copied from `apps/auth`'s ESM config, fails before any test runs: `Cannot require() ES Module .../packages/shared-types/dist/index.js in a cycle`, thrown from `packages/database/dist/src/database.service.js`.

**Cause:** in ESM mode `ts-jest` compiles the app's own `src/` to ESM. A controller that imports both `@repo/shared` (CommonJS, which `require`s `@repo/database` → `@repo/shared-types`) and `@repo/shared-types` (ESM) puts `shared-types` into the ESM graph that is being linked. The CJS `require()` of it then counts as a cycle, and Jest refuses it. `apps/auth`'s integration suite never imports app source, so it never hits this.

**Fix:** keep the suite's **test files in CommonJS** (plain `ts-jest`, no `useESM`/`extensionsToTreatAsEsm`, `tsconfig.test.json`), but **keep `NODE_OPTIONS='--experimental-vm-modules'`** on the script. That flag is what lets Jest `require(esm)` the pure-ESM `@faker-js/faker` from `@repo/testing-utils` (Node ≥24.9). See `apps/api/test/jest-integration.json`. With CJS test files the `jest` global is injected, so do not `import { jest } from '@jest/globals'`.

### `Nest can't resolve ClsService` in an ESM-mode Jest suite — import it from `@repo/shared`

**Symptom:** `apps/auth`'s e2e (ESM Jest) fails at boot with `Nest can't resolve dependencies of the Symbol(AUTH_MODULE_OPTIONS) (…, ?)… ClsService at index [2]`, although the same code runs fine under `pnpm dev`.

**Cause:** `inject: [ClsService]` imported from `nestjs-cls` in the app. Under ESM mode Jest loads the app's own copy of the package as ESM while `@repo/shared`'s CommonJS `dist` loaded another, so the `ClsService` class (the DI token) differs from the one `SharedModule`'s `ClsModule` provides.

**Fix:** `@repo/shared` re-exports `ClsService`; apps import it from there (and do not declare `nestjs-cls` themselves). Same family as the `require(esm)` entry above: anything shared that is also a DI token must come from a single package.

### `jest.setup.ts` `override: true` silently re-points `globalSetup`'s container URLs at localhost

**Symptom:** with Testcontainers wired in via `globalSetup`, the suites still connect to (and `DELETE FROM "user"` in) a Postgres on `localhost:5432`.

**Cause:** Jest runs `globalSetup` first, then each worker runs `setupFiles`. `dotenv.config({ path: '.env.test', override: true })` overwrites `process.env.DATABASE_URL` with whatever `.env.test` holds, and localhost `??` fallbacks fill any gap.

**Fix:** `apps/auth/.env.test` carries no `DATABASE_URL` / `MONGO_URI` / `REDIS_HOST` / `REDIS_PORT`, `jest.setup.ts` has no localhost fallbacks, and it throws when `E2E_CONTAINERS_RUN_ID_ENV` (set by `globalSetup`) is missing — so running Jest with a config that lacks `globalSetup` fails loudly instead of hitting a local database. New apps' suites should follow the same pattern.

### `apps/web`'s Angular CLI refuses to run under the shell's default active Node version

**Symptom:** `pnpm --filter web test` (or `build`/`lint`) fails immediately with `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0` even though a correct Node version is installed on the machine — the shell's currently-active `node -v` just isn't one of them (e.g. `v24.14.1`, one patch below the `v24.15.0` floor).

**Fix:** `nvm use` (or check `nvm ls`) against the version pinned in `.nvmrc` (`v24.19.0`) before running any `apps/web` script — it's usually already installed, just not the shell's active version. Also note: `ng test` (Angular 22's `@angular/build:unit-test` Vitest-based builder) does not accept a `-- <spec-file>` filter the way Jest-backed app scripts do (`Option '--' has been specified multiple times` / schema validation error) — run `pnpm --filter web test` for the whole suite; there is no supported single-file shortcut through the package script.
