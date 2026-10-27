# Tasks

## 0. Branch

- [x] 0.1 chore: create `feature/add-audit-log` from `develop` and confirm `git branch --show-current` before every group commit — verify the branch exists and HEAD is on it

## 1. Shared audit contract

- [x] 1.1 test(shared-types): packages/shared-types: write `src/schemas/audit.schema.spec.ts` covering `AUDIT_ACTIONS` (every action in design D3a/D4 present, unknown rejected), `SAFE_CHANGE_FIELDS`, `auditEventSchema` (ISO dates decode, optional fields nullable/absent), `auditEventListQuerySchema` (defaults, `take` ≤ 100, `action`/`outcome` enums, `from`/`to` ISO coercion, rejects unknown action) and `auditEventsListResponseSchema` (rejects missing `meta.total`) — verify the suite fails
- [x] 1.2 feat(shared-types): packages/shared-types: implement `src/schemas/audit.schema.ts` (no root `.meta({ id })` on the query schema) and export it — verify `pnpm --filter @repo/shared-types test` passes
- [x] 1.3 Commit group 1 with `/commit`

## 2. Audit storage and service

- [x] 2.1 test(shared): packages/shared: write specs for `MongoService.createAuditEvent` / `findAuditEvents` (filters, sort desc, skip/take, total) and `AuditService.record` (`expireAt` = occurredAt + `AUDIT_RETENTION_DAYS`, default 365; `changes` filtered to `SAFE_CHANGE_FIELDS`; correlation ID filled from `ClsService`; Mongo failure → no throw, `Logger.error` + Sentry called with action and correlation ID) — verify the suites fail
- [x] 2.2 feat(shared): packages/shared: add the `AuditEvent` schema (collection `audit_events`, indexes and `expireAt` TTL from design D1) to `MongoModule`, the two `MongoService` methods (no update or delete), and `AuditService` provided and exported by `SharedModule`; re-export the action constants — verify `pnpm --filter @repo/shared test` passes and `pnpm --filter @repo/shared build` succeeds
- [x] 2.3 test(shared): packages/shared: write specs for the `@Audit()` decorator metadata, `AuditContextGuard` (always allows, copies metadata to `req.audit`), `AuditInterceptor` (success → `success` with target from param or response id and `changedFields` from body keys; thrown `HttpException` → `failure` with status) and `AllExceptionFilter` (401/403 with `req.audit` → records failure with action, status and `req.user`; without `req.audit` or without `AuditService` → records nothing; response unchanged) — verify the suites fail
- [x] 2.4 feat(shared): packages/shared: implement the decorator, guard and interceptor under `src/audit/`, and the `@Optional() AuditService` path in `AllExceptionFilter` (design D4/D5) — verify `pnpm --filter @repo/shared test` passes
- [x] 2.5 Commit group 2 with `/commit`

## 3. Auth events (apps/auth)

- [x] 3.1 test(auth): apps/auth: write `src/audit/auth-audit.spec.ts` for `buildAuthEvent` covering every allow-list row in design D3a: success and `APIError` failure (`errorCode` from status and `body.code`), failed sign-in `attemptedEmail` with and without an existing user, impersonation (`impersonatedById`), admin target from `body.userId` or the returned user, safe-only `changes`, and no password, token, code or session id anywhere in the event; plus `AuthAuditHook` ignores unknown and read paths (`/get-session`, `/admin/list-users`) — verify the suite fails
- [x] 3.2 feat(auth): apps/auth: add `AUTH_AUDIT_PATHS`, `buildAuthEvent` and the `@Hook()` `AuthAuditHook` provider (`@AfterHook()` with no path), register it in `AppModule`, and add `AUDIT_RETENTION_DAYS` to `src/env.ts` and `.env.example` — verify `pnpm --filter auth test` passes
- [x] 3.3 test(auth): apps/auth: runtime check (design D3 risks) with `pnpm dev`: sign in, sign out and ban through the web, then confirm in Mongo `audit_events` that sign-out carries the actor and that every event has a `correlationId`; if either is missing, apply the documented fallback (`@BeforeHook('/sign-out')` stash and/or the module `middleware` CLS wrap) — record the result in `.claude/CORNER_CASES.md` (Authentication)
- [x] 3.4 test(auth): apps/auth: extend `test/auth.e2e-spec.ts`: sign-in success and wrong password produce `auth.sign-in` success/failure events (failure has `attemptedEmail`, no password), admin ban and set-role produce events with admin actor, target user and safe `changes`, and `get-session` produces none — verify `pnpm --filter auth test:e2e` passes
- [x] 3.5 Commit group 3 with `/commit`

## 4. API events and query endpoint (apps/api)

- [x] 4.1 test(auth,api): apps/auth: `auth.controller.spec` — the `AUTH_AUTHENTICATE` reply carries `impersonatedBy` only for an impersonation session (needed so `apps/api` can name the real admin; normal sessions are unchanged); apps/api: controller specs asserting `@Audit` metadata on customer create/update/delete (none on reads), a spec asserting `AuditContextGuard` is registered before `MicroserviceAuthGuard` and `RolesGuard` in `AppModule`, and `audit-events.controller.spec.ts` asserting `@Roles(ADMIN)` and GET-only — verify the suites fail
- [x] 4.2 feat(auth,api): apps/auth: include `impersonatedBy` in the authenticate reply when present; apps/api: decorate the customer write handlers, register `AuditContextGuard` (first `APP_GUARD`) and `AuditInterceptor`, add `AuditEventsController` (`GET /api/v1/audit-events`, design D6) and `AUDIT_RETENTION_DAYS` in `src/env.ts`, `.env.example` and `.env.test` — verify `pnpm --filter api test` passes and `/api/docs` lists the endpoint
- [x] 4.3 test(api): apps/api: write `test/audit.integration.ts` (real Mongo and Postgres): customer create/update/delete success events with target and `changedFields` (`taxId` listed, no NIF value anywhere); 409, 401 and 403 failure events with the right actor; `expireAt` ≈ occurredAt + configured days; query filters (actor, target, action, outcome, date range), pagination, newest first; non-admin 403; PATCH/DELETE `/audit-events/:id` → 404; listing customers produces no event — verify `pnpm --filter api test:integration` passes
- [x] 4.4 Commit group 4 with `/commit`

## 5. Audit page (apps/web)

- [x] 5.1 test(web): apps/web: write `features/audit/audit.api.spec.ts` (query params mapping, response parsed, malformed → reject) and `features/audit/audit.spec.ts` (renders rows; filter changes call the API with the right params and reset to page 0; load error → no rows) plus a shell spec case: the Audit nav entry only for admins — verify the suites fail
- [x] 5.2 feat(web): apps/web: implement `AuditApi`, the `audit` page (MatTable, filters, MatPaginator, MatDatepicker range), the `audit` route with `adminGuard`, and the System nav entry (`policy` icon, `adminOnly: true`) per design D7 — verify `pnpm --filter web test` and `pnpm --filter web build` pass
- [x] 5.3 Commit group 5 with `/commit`

## 6. Docs and end-to-end verification

- [x] 6.1 docs: README environment section: `AUDIT_RETENTION_DAYS` (default 365, per-document expiry, applies to new events only); `CONVENTIONS.md`/`CLAUDE.md`: how to audit a new write (`@Audit` in apps/api, add a path to `AUTH_AUDIT_PATHS` in apps/auth), and that the HTTP `Log` is not an audit trail — verify the variable appears in README and both `.env.example` files
- [x] 6.2 test: run `pnpm build`, `pnpm lint`, `pnpm check-types` and `pnpm test` at the root — verify all exit 0
- [x] 6.3 test: runtime verification with the `verify` skill: as admin, ban/unban, set role and set password on a test user; impersonate and update its profile; create/update/delete a customer; a wrong-password sign-in; a non-admin customer write (403). Confirm each appears on `/audit` with the right actor, impersonatedBy, target, outcome and changes, that `/audit` is not reachable as non-admin, and that no NIF, password or token appears in `audit_events` — record the results in the PR description
- [x] 6.4 Commit group 6 with `/commit`

## 7. Hardening found by the post-implementation /verify

- [x] 7.1 test(shared,auth): packages/shared: `ContextUtil.clientIpFromForwardedFor` (first hop never trusted, hop counting, fewer entries than hops, no header, zero hops) and `AuditService` size limits (every capped field, 50 × 64 changed fields, 500-char change values, <8 KB worst case); apps/auth: builder takes the proxy-appended address and ignores `x-real-ip`, and the hook stops waiting after `AUDIT_HOOK_MAX_WAIT_MS` with no timer left behind; e2e for a 200 000-char attempted email and a forged `X-Forwarded-For` — verify the new cases fail first
- [x] 7.2 fix(shared,auth): packages/shared: `TRUSTED_PROXY_HOPS` constant (also used by `BootstrapUtil`), `ContextUtil.clientIpFromForwardedFor`, `AUDIT_LIMITS` applied in `AuditService.record`; apps/auth: use the trusted-hop address and a bounded wait in `AuthAuditHook` — verify `pnpm --filter @repo/shared test`, `pnpm --filter auth test` and `pnpm --filter auth test:e2e` pass
- [x] 7.3 docs: README audit section (size bounds, trusted-proxy address, 2 s wait) and the `.github`/CLAUDE/CONVENTIONS lines that describe the hook — verify the three numbers match the code constants
- [x] 7.4 test: rerun the failing probes against the running stack — a 200 000-char email and 3 000 keys store small events, a forged `X-Forwarded-For` is not recorded, and a sign-in with Mongo paused answers within a few seconds — record the numbers in the PR description
- [x] 7.5 Commit group 7 with `/commit`

## 8. Second /verify round

- [x] 8.1 test(shared,auth): `ContextUtil.clientIpFromForwardedFor` returns undefined for a trusted entry that is not an IP (text, out-of-range, truncated, huge) and still accepts IPv4, IPv6 and v4-mapped; the auth builder records no `ip` for such a header — verify the new cases fail first
- [x] 8.2 fix(shared): validate the trusted entry with `net.isIP` in `ContextUtil.clientIpFromForwardedFor` — verify `pnpm --filter @repo/shared test` and `pnpm --filter auth test` pass
- [x] 8.3 chore: remove the oversized audit events left in the local Mongo by the pre-fix probes (a 200 KB and a 46 KB event) after listing them — verify `GET /api/v1/audit-events?take=100` is back to a few KB and no event is over 8 KB
- [x] 8.4 docs: README client-address line mentions the IP check — verify wording
- [x] 8.5 Commit group 8 with `/commit`

## 9. Third /verify round

- [x] 9.1 test(shared,auth,api): `AuditService` drops `changedFields`/`changes` on failures and keeps them on successes; auth builder resolves the revoke-user-session target from `auditTargetId` and has none without it; the new before hook stashes the session owner, ignores an unknown or missing token and never throws; auth e2e asserts the revoke target and that a refused ban records no changes; api integration asserts refused writes list no changed fields — verify the new cases fail first
- [x] 9.2 fix(shared,auth): central failure stripping in `AuditService.record`; `AuthAuditHook.rememberRevokedSessionOwner` (`@BeforeHook('/admin/revoke-user-session')`) and a `stashed` target in `AUTH_AUDIT_PATHS` — verify `pnpm --filter @repo/shared test`, `pnpm --filter auth test`, `pnpm --filter auth test:e2e` and `pnpm --filter api test:integration` pass
- [x] 9.3 docs: README audit section states that failures record no changed fields — verify wording
- [x] 9.4 test: rerun the real-route probe — `admin.user.revoke-session` shows the session owner as target and no failure event carries changes — record the result in the PR description
- [x] 9.5 Commit group 9 with `/commit`

## 10. Fourth /verify round (UI)

- [x] 10.1 test(shared-types,shared,api,web): query schema accepts `actorEmail` (trimmed, lowercased, not empty); `MongoService` matches it against actor and attempted email and keeps combining with other filters; api integration filters by email ignoring case; web sends an email in the actor field as `actorEmail` and anything else as `actorId`, and the actor cell carries the id as `title` — verify the new cases fail first
- [x] 10.2 fix(shared-types,shared,web): add the `actorEmail` filter end to end and one "Actor (email or id)" field with an id tooltip on the actor cell — verify unit and integration suites pass and `pnpm --filter web build` succeeds
- [x] 10.3 docs: README audit section mentions filtering by email — verify wording
- [x] 10.4 test: in the browser, typing an email in the actor field lists that user's events and failed sign-ins, hovering the actor shows the id — record in the PR description
- [x] 10.5 Commit group 10 with `/commit`

## Workflow follow-up

- Run `/opsx:verify`, then `/opsx:archive` with spec sync.
- Separate change: stop `LocalAuthService` notification hooks from firing on failed requests (design Risks).
- Separate change: make the HTTP request `Log` record 401/403 and better-auth routes, if still wanted.
