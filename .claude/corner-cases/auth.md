# Corner cases — Authentication (better-auth)

## `BETTER_AUTH_URL` drives the `Secure` cookie prefix, not the proxy headers

**Symptom:** the session cookie is issued without the `Secure` attribute (and without the `__Secure-` name prefix) even though the app sits behind an HTTPS-terminating reverse proxy that correctly forwards `X-Forwarded-Proto: https`.

**Fix:** better-auth derives the `Secure` prefix from `advanced.useSecureCookies`, else from whether `baseURL` (i.e. `BETTER_AUTH_URL`) itself starts with `https://`, else from `isProduction` — **never** from `X-Forwarded-Proto` or any other proxy header. Set `BETTER_AUTH_URL` to the actual public `https://` origin (e.g. `https://auth.example.com/api/auth`); a plain-`http://` or container-internal value here silently drops the `Secure` prefix no matter how the proxy in front of it is configured. Verified against a real `Set-Cookie` header from a running `apps/auth` instance with `BETTER_AUTH_URL=https://…`: `__Secure-better-auth.session_token=…; Secure; SameSite=Lax; Domain=…`.

## better-auth 1.7.3 validates the Prisma schema at startup by default and rejects auth requests on any mismatch

**Symptom:** upgrading from better-auth 1.7.2 to 1.7.3 with no other code change causes every request that touches the `twoFactor()` plugin (and, by extension, most auth flows once that plugin is registered) to fail with `Prisma schema mismatch — Missing columns: twoFactor.verified, twoFactor.failedVerificationCount, twoFactor.lockedUntil`.

**Cause:** these three columns are not new — `@better-auth/core`'s `two-factor/schema.ts` declares them identically in 1.7.2 and 1.7.3 (confirmed by diffing the installed packages), and `auth.prisma`'s `TwoFactor` model never had them. What's new in 1.7.3 is the feature itself: *"Enabled schema validation during initialization by default, including in production, and rejected authentication requests on detected mismatches"* (1.7.3 release notes). 1.7.2 silently tolerated the gap since better-auth marks all three fields `required: false`; 1.7.3 now checks the Prisma client's `_runtimeDataModel` against every registered plugin's expected fields and throws on any that are absent, regardless of whether that field is actually required.

**Fix:** this is a genuine, previously-latent gap, not a reverted feature like the `Account.issuer` case below — add the missing columns. Because all three are optional/defaulted on better-auth's side (`verified: Boolean? @default(true)`, `failedVerificationCount: Int? @default(0)`, `lockedUntil: DateTime?`), this is purely additive: no uniqueness constraint, no NOT NULL, no data rewrite, safe even for a project with existing `twoFactor` rows. **Do not stop at editing `auth.prisma` and regenerating the migration** — see the `pnpm db:generate` / `pnpm build` entry under Database above; skipping the rebuild step reproduces the exact same "missing columns" error even after the database and the schema source are both already correct.

If a future better-auth upgrade reports a similar mismatch for a different plugin, check whether the plugin's own schema definition actually changed between versions (a real new requirement) before assuming it did — as with `Account.issuer`, better-auth sometimes reverts a schema change between versions, and the two failure modes look identical from the error message alone. Diff the installed package's schema source between versions before writing a migration.

## better-auth routes run outside Nest: no CLS, no interceptors, and an after hook that throws replaces the response

**Symptom:** audit events recorded from a better-auth hook had no `correlationId`, `/sign-out` events had no actor, and the Mongo request `Log` has no `/api/auth/*` entries at all.

**Cause:** `@thallesp/nestjs-better-auth` mounts the handler with `httpAdapter.use(...)`, i.e. raw Express, ahead of Nest's middleware chain. So (1) the global CLS middleware never runs for those routes, and `ClsService.get()` has no store; (2) interceptors and guards never see them; (3) better-auth clears the session during `/sign-out`, so by the time an after hook runs `ctx.context.session` is gone; (4) better-auth runs after hooks on failures too (`ctx.context.returned` is the `APIError`) and an `APIError` thrown from an after hook **replaces the real response**.

**Fix:** `apps/auth/src/audit/`: pass the module's `middleware` option (`withCorrelationId(cls)`) to wrap the handler in a CLS context; a `@BeforeHook('/sign-out')` looks the session up first and stashes it on `ctx.context.auditSession`; and `AuthAuditHook.onAfter` wraps everything in try/catch and never throws. Detect a failed request by shape (`Error` with a numeric `statusCode`), not `instanceof`, so unit tests need not load the ESM better-auth package.

## `*` means opposite things to `enableCors` and to `trustedOrigins`

**Symptom:** a `CORS_ORIGIN`/origin-allowlist value of `*` looks like it should behave the same way in every place it's consumed, but it doesn't — in one place it silently blocks everything, in the other it silently trusts everything.

**Fix:** `BootstrapUtil`'s `enableCors` (see `packages/shared/src/utils/bootstrap.util.ts`) always calls Nest's `app.enableCors({ origin: [...] })` with an **array** (splitting the comma-joined `CORS_ORIGIN` string) — the `cors` package only pattern-matches when given a function; given an array it does a literal string comparison, so a literal `"*"` entry never equals any real browser `Origin` header and is effectively a no-op that grants nothing. better-auth's `trustedOrigins`, by contrast, treats a bare `*` as a genuine wildcard pattern (`matchesOriginPattern`) that trusts **every** origin. `apps/auth/src/app.module.ts` filters `*` out of the list before it reaches `trustedOrigins` for exactly this reason — do not "simplify" that filter on the assumption the two behave the same.

## `admin.createUser` sends no verification email — invitations go through `requestPasswordReset`

better-auth's `/admin/create-user` creates the user with `emailVerified: false` and, when no `password` is passed, **no credential account**, and it never calls `sendVerificationEmail`. Under `requireEmailVerification: true` such an account cannot sign in until something verifies it. The invitation is `auth.api.requestPasswordReset({ body: { email, redirectTo } })` from `databaseHooks.user.create.after`, gated on `context?.path === '/admin/create-user'`: `resetPassword` _creates_ the credential account when none exists, and `sendResetPassword` tells an invitation from a reset by whether that credential account exists. The hook can find the user because `databaseHooks.*.after` run after the creating transaction commits. `auth` must be bound to a `const` before the options object closes over it (see `apps/auth/src/app.module.ts`). `redirectTo` is origin-checked only for requests that come through HTTP; a server-side `auth.api` call has no request, so the check is skipped.

## `onPasswordReset` receives the user as loaded _before_ the reset

`resetPassword` loads the user, writes the new password, then calls `onPasswordReset({ user })` with that earlier row — and never touches `emailVerified`. So `user.emailVerified === false` inside the hook means "this password set is the account's activation"; the hook marks the email verified itself (following the emailed link proves ownership of the address). Don't key activation on `afterEmailVerification`: it also fires at the end of an email _change_.

## `@AfterHook` handlers also run for refused requests

`@thallesp/nestjs-better-auth`'s `@AfterHook('/change-password')` fires even when better-auth refused the change (wrong current password), and the caller's session is still valid, so a "password changed" email would go out for a password that did not change. `LocalAuthService.isRefused(ctx)` (`ctx.context.returned instanceof Error`) makes every notifying hook return early. Detect by `instanceof Error`, not by importing better-auth's `APIError` (ESM-only, which the CommonJS unit suite cannot load). A hook must also never _throw_ on a refused request: an `APIError` thrown from an after hook replaces the real response.

## `apps/auth` e2e suites must run in band

Every auth e2e file calls `truncateDatabase` in `afterAll` against the one Testcontainers Postgres. Run in parallel, the first file to finish wipes the other's users and sessions mid-run and its authenticated requests start failing with 401. `test:e2e` passes `--runInBand`.

## The global throttler does not cover `/api/auth/*` — better-auth limits itself

`SharedModule` registers `ThrottlerModule` but no global `APP_GUARD` for it, so Nest rate limiting is opt-in per route via `@RateLimit()`. better-auth serves `/api/auth/*` with its own handler, outside the Nest guard pipeline, so `@RateLimit()` can never reach sign-in. better-auth's own limiter is production-only and in-memory by default (per worker), which left dev with no login throttle at all. `apps/auth` therefore sets `betterAuth({ rateLimit })` explicitly: enabled everywhere but `test` (the e2e suites hammer sign-in), strict `customRules` on `/sign-in/email`, `/sign-up/email`, `/two-factor/verify-*`, `/request-password-reset`, `/reset-password`, backed by a shared-Redis `customStorage` (`rate-limit.storage.ts`: atomic Lua `INCR`+`EXPIRE`, fails open if Redis is down). In better-auth 1.7.6 a refused request is a `429` carrying `X-Retry-After` (not `Retry-After`), and `/forget-password` no longer exists — only `/request-password-reset`.
