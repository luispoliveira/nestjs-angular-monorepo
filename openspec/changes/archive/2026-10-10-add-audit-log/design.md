# Design

## Context

See proposal.md (Why) and `specs/audit-log/spec.md` for the required behaviour. Facts verified in the codebase that shape the approach:

- **better-auth 1.7.6** runs behind `@thallesp/nestjs-better-auth` 2.8.0, which mounts the handler with `httpAdapter.use(...)` (raw Express). Nest interceptors and guards never run for `/api/auth/*`, which is why the Mongo request `Log` has no auth entries.
- better-auth runs **after hooks on failures too**: on an `APIError` it sets `ctx.context.returned` to the error, runs the after hooks, and only then rethrows (`api/dispatch.ts`). `isAPIError(returned)` tells failure from success.
- `@thallesp`'s `setupHooks` chains every `@AfterHook(path)` method of a `@Hook()` provider into `auth.options.hooks.after`. A method decorated with `@AfterHook()` and **no path** runs for every path (`if (hookPath && hookPath !== ctx.path) return`). `LocalAuthService` already uses this mechanism, and `hooks: {}` exists, which `setupHooks` requires.
- In `apps/api`, Nest exception filters receive an `ExecutionContextHost([req, res, next])` **without a handler** (`router-proxy.js`), so a filter cannot read route metadata. Guards and interceptors do get `ExecutionContext.getHandler()`.
- `SharedModule` provides `MongoService` (via `MongoModule`) and `ClsService` globally in every app. The CLAUDE.md convention is "write Mongo via `MongoService`; never inject Mongoose models in feature code". The existing `Log` schema uses `timestamps` plus a fixed `createdAt` TTL of 30 days.
- The better-auth endpoint paths used by this app (admin plugin, twoFactor, emailAndPassword) were listed from the installed package.

## Goals / Non-Goals

**Goals:**
- One event shape and one write path (`AuditService`) shared by `apps/auth` and `apps/api`.
- The allow-list of audited auth paths lives in exactly one constant.
- Audit code never changes the outcome or latency profile of the audited action beyond one awaited insert.

**Non-Goals:**
- Changing the HTTP request `Log` or its interceptor.
- Fixing the pre-existing issue that the `LocalAuthService` notification hooks also fire on failed requests (see Risks). It is noted, not changed here.

## Decisions

### D1 — Storage: `audit_events` collection via `MongoService` (`packages/shared`)

```ts
@Schema({ collection: 'audit_events', versionKey: false })   // no `timestamps`
class AuditEvent {
  occurredAt: Date;            // required
  expireAt: Date;              // occurredAt + AUDIT_RETENTION_DAYS
  action: AuditAction;         // e.g. 'auth.sign-in', 'admin.user.ban', 'customer.update'
  outcome: 'success' | 'failure';
  errorCode?: string;          // HTTP status, plus better-auth error code when present
  actorId?: string; actorEmail?: string;
  impersonatedById?: string;
  attemptedEmail?: string;     // failed sign-in only
  targetType?: 'user' | 'customer'; targetId?: string;
  changedFields?: string[];
  changes?: Record<string, unknown>;   // safe-list values only
  ip?: string; userAgent?: string; correlationId?: string;
}
indexes: { expireAt: 1 } (expireAfterSeconds: 0), { occurredAt: -1 },
         { actorId: 1, occurredAt: -1 }, { targetId: 1, occurredAt: -1 },
         { action: 1, occurredAt: -1 }, { outcome: 1, occurredAt: -1 }
```

- **Per-document `expireAt`** instead of a TTL on `occurredAt`. Changing `AUDIT_RETENTION_DAYS` then never alters an existing index, which would otherwise raise `IndexOptionsConflict` at startup or be silently ignored. It satisfies the "changed retention" scenario. Trade-off: events already stored keep their original expiry.
- `MongoService` gains `createAuditEvent(data)` and `findAuditEvents(filter, skip, take)`, returning `{ items, total }`. There is deliberately no update or delete method (immutability).
- *Alternative:* a separate Mongoose connection or database for audit. Rejected for a template, because the same `MONGO_URI` keeps operations simple.

### D2 — `AuditService` (`packages/shared/src/audit/`), provided globally by `SharedModule`

```ts
record(event: AuditInput): Promise<void>
// fills occurredAt, expireAt (ConfigService AUDIT_RETENTION_DAYS ?? 365),
// correlationId (ClsService, if the input has none); filters `changes` to SAFE_CHANGE_FIELDS;
// try { await mongo.createAuditEvent(...) } catch (e) { logger.error + SentryUtil.captureException
//   with { action, correlationId } }  -- never rethrows
```

- `SAFE_CHANGE_FIELDS = ['role', 'banned', 'banReason', 'banExpires']` and the action names live in `@repo/shared-types` as `AUDIT_ACTIONS` (a `z.enum`), so the web filter dropdown and the backend share one list. Consumers import them from `@repo/shared-types` directly (one import path for the single source).
- The service is global so that `AllExceptionFilter`, which is shared, can inject it (D5). Apps that never audit pay nothing.
- **Failures carry no changes:** `AuditService.record` drops `changedFields` and `changes` from an event whose outcome is `failure` (a refused action changed nothing; listing the attempted fields read as if they had applied). Found by the third runtime verification.
- **Size bounds** (found by runtime verification): `AuditService.record` truncates every client-controlled field before storing (`AUDIT_LIMITS`: emails 254, user agent 256, ids 128, address 64, error code 128; at most 50 changed-field names of 64 characters; change values 500), so one event stays under ~8 KB whatever the request sends. Truncation is silent and central, so both apps get it.
- `AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365)` is added to the env schemas of `apps/auth` and `apps/api`, the two apps that record events.

### D3 — `apps/auth`: one `@AfterHook()` provider with a path allow-list

```ts
@Hook() @Injectable()
export class AuthAuditHook {
  @AfterHook()                       // no path → every better-auth endpoint
  async onAfter(ctx: AuthHookContext) {
    const spec = AUTH_AUDIT_PATHS[ctx.path];   // unknown/read paths → return (D3a)
    if (!spec) return;
    await this.audit.record(buildAuthEvent(spec, ctx));   // pure function, unit-tested
  }
}
```

**D3a — allow-list** (path → action, target, changed fields):

| Path | Action | Target / changes |
|---|---|---|
| `/sign-in/email` | `auth.sign-in` | actor = returned user; failure → `attemptedEmail = body.email` |
| `/sign-up/email` | `auth.sign-up` | actor = returned user |
| `/sign-out` | `auth.sign-out` | actor = session user (read before it is cleared, see Risks) |
| `/change-password` | `auth.change-password` | target = self |
| `/request-password-reset`, `/reset-password` | `auth.password-reset.request` / `.complete` | `attemptedEmail` on request |
| `/change-email`, `/verify-email` | `auth.change-email` / `auth.verify-email` | `changedFields: ['email']`, no value |
| `/update-user` | `auth.update-user` | `changedFields = keys(body)`, safe values only |
| `/delete-user` | `auth.delete-user` | target = self |
| `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` | `auth.revoke-session(s)` / `auth.revoke-other-sessions` | target = self |
| `/two-factor/enable`, `/disable`, `/generate-backup-codes` | `auth.two-factor.enable` / `.disable` / `.backup-codes` | target = self |
| `/two-factor/verify-totp`, `/verify-otp`, `/verify-backup-code` | `auth.two-factor.verify` | actor = new session user |
| `/admin/create-user` | `admin.user.create` | target = returned user id; `changedFields: ['role', …]` |
| `/admin/update-user` | `admin.user.update` | target = `body.userId`; `changedFields = keys(body.data)` |
| `/admin/remove-user` | `admin.user.remove` | target = `body.userId` |
| `/admin/ban-user` / `/admin/unban-user` | `admin.user.ban` / `.unban` | `changes: { banned, banReason, banExpires }` |
| `/admin/set-role` | `admin.user.set-role` | `changes: { role }` |
| `/admin/set-user-password` | `admin.user.set-password` | `changedFields: ['password']`, no value |
| `/admin/impersonate-user` / `/admin/stop-impersonating` | `admin.user.impersonate` / `.stop-impersonating` | target = `body.userId` / impersonated user |
| `/admin/revoke-user-session` | `admin.user.revoke-session` | target = owner of `body.sessionToken`, looked up by a `@BeforeHook` and stashed on `ctx.context.auditTargetId` (the request carries no user id) |
| `/admin/revoke-user-sessions` | `admin.user.revoke-sessions` | target = `body.userId` |

- **Outcome:** `isAPIError(ctx.context.returned)` → `failure`, with `errorCode` = `${status}` plus `body.code` when present.
- **Actor:** `ctx.context.newSession?.user ?? ctx.context.session?.user`. `impersonatedById` comes from `session.session.impersonatedBy`.
- **IP and user agent:** from `ctx.headers`. The address is the `X-Forwarded-For` entry the trusted proxy appended (`ContextUtil.clientIpFromForwardedFor`, `TRUSTED_PROXY_HOPS = 1`, the same rule `BootstrapUtil` gives Express `trust proxy`); the first entry is client-supplied and never used, and `x-real-ip` is ignored for the same reason. The entry must also be a valid IP (`net.isIP`): anything else, including a malformed header, records no address instead of arbitrary client text. With no forwarded header (direct access in development) no address is recorded.
- **Correlation ID (verified at runtime, task 3.3):** better-auth is mounted outside Nest's middleware chain, so `ClsService` has no store inside the hook and events came out with no `correlationId`. The `AuthModule` `middleware` option wraps the handler in `cls.run(...)` with a fresh id (`withCorrelationId`, `apps/auth/src/audit/correlation.middleware.ts`). `ClsService` is imported from `@repo/shared`, not `nestjs-cls`: under Jest's ESM mode the app's own copy is a different class from the one `SharedModule` provides (see CORNER_CASES).
- **Bounded wait:** the hook awaits the write so the event normally exists when the response leaves, but only for `AUDIT_HOOK_MAX_WAIT_MS` (2 s). With Mongo unreachable the driver blocks ~30 s (measured: a sign-in took 35 s), so past the budget the response goes out and the write finishes, or fails and is reported, in the background.
- **Sign-out actor (verified at runtime, task 3.3):** better-auth clears the session during `/sign-out`, so the after hook had no actor. `AuthAuditHook` has a `@BeforeHook('/sign-out')` that looks the session up and stashes it on `ctx.context.auditSession`; `buildAuthEvent` uses it as a last-resort actor source.
- *Alternative:* about 30 `@AfterHook('/path')` methods. Rejected, because a newly used endpoint would silently go unaudited.

### D4 — `apps/api`: `@Audit()` decorator + interceptor for handled requests

```ts
@Audit('customer.update', { targetType: 'customer', targetParam: 'id' })
@Patch(':id') update(...)
```

- `AuditInterceptor` (APP_INTERCEPTOR in `apps/api`) reads the metadata. On success it records `outcome: success`, with `targetId = params.id ?? response.id` and `changedFields = keys(validated body)`. On error it records `failure` with the HTTP status, so 400, 404 and 409 are covered.
- Customers use it on create, update and delete. This also makes it the reference pattern the slice teaches.

### D5 — `apps/api`: guard rejections (401/403)

Guards run before interceptors, so a 401/403 never reaches `AuditInterceptor`, and the exception filter has no handler to read metadata from.

- `AuditContextGuard` is registered as the **first** `APP_GUARD` in `apps/api`'s `AppModule` (Nest runs global guards in registration order). It always returns `true` and copies the handler's `@Audit` metadata onto `req.audit`.
- `AllExceptionFilter` (shared) gets `@Optional() AuditService`. For an HTTP 401/403 whose `req.audit` is set, it records a `failure` with that action, the status and `req.user` (absent on 401).
- `request.user` is the `AUTH_AUTHENTICATE` reply (`session.user`), which has no session data. `apps/auth`'s `authenticate` therefore adds `impersonatedBy` to the reply when the session is an impersonation, so the interceptor and filter can record the real admin. Normal sessions get exactly the reply they got before.
- *Alternative:* matching `req.route.path` against a registry built with `DiscoveryService`. Rejected as more machinery for the same result.

### D6 — Query API (`apps/api`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/v1/audit-events` | `ADMIN` | `auditEventListQuerySchema`: `skip`, `take` (≤100), `actorId?`, `actorEmail?` (trimmed, lowercased; matches the actor email or the attempted email of a failed sign-in), `targetId?`, `action?` (enum), `outcome?`, `from?`, `to?` (ISO). Sorted by `occurredAt` desc. Response `paginatedSchema(auditEventSchema)` |

- No other methods exist on the resource, so PATCH/PUT/DELETE get the framework's 404 (immutability scenario).
- The query schema has no root `.meta({ id })`, the same rule as `customerListQuerySchema`.
- The controller is not `@Audit`-decorated, because reads are never recorded.

### D7 — Web (`apps/web/src/app/features/audit/`)

- `AuditApi` (same pattern as `CustomersApi`: `HttpClient` + response parsing through the shared schemas).
- The `audit` page lives in the shell, with `canActivate: [adminGuard]` and a nav entry in the **System** group with `adminOnly: true` and icon `policy`. It holds a `MatTable` (time, actor, impersonated by, action, target, outcome), filters (action select from `AUDIT_ACTIONS`, outcome select, actor/target id inputs, a date range with `MatDatepicker`) and a `MatPaginator`.

### D8 — Tests (SDD: spec → tests → code)

| Level | Where | Covers |
|---|---|---|
| unit | `packages/shared-types` | `AUDIT_ACTIONS`, query/response schemas |
| unit | `packages/shared` | `AuditService` (expireAt from env/default, safe-field filtering, correlation fill, swallow + Sentry on Mongo failure); `AllExceptionFilter` 401/403 with/without `req.audit`; `AuditContextGuard` |
| unit | `apps/auth` | `buildAuthEvent` per allow-list row (success/failure, attempted email, impersonation, no secrets); unknown path → no event |
| unit | `apps/api` | `AuditInterceptor` success/failure; controller `@Roles` and `@Audit` metadata |
| integration | `apps/api/test` (existing harness) | customer writes audited, incl. 401/403/409; real Mongo `audit_events` with `expireAt`; query filters and pagination; PATCH/DELETE on `/audit-events` → 404; non-admin 403 |
| e2e | `apps/auth/test` (existing testcontainers e2e) | sign-in success and wrong password; admin ban and set-role → events with the right actor/target/changes; `get-session` → no event |
| unit | `apps/web` | page filters → API params; admin-only nav and route; malformed response → error state |

## Risks / Trade-offs

- [better-auth paths rename across versions] → The allow-list is a single constant, unit tests cover every row, and the auth e2e exercises real routes, so an upgrade that renames a path fails a test.
- [Sign-out loses the actor] → Resolved in task 3.3 (before-hook stash, see D3).
- [Correlation ID unavailable inside better-auth hooks] → Resolved in task 3.3 (module `middleware` + CLS, see D3).
- [The pre-existing notification hooks (`LocalAuthService`) fire on failed requests too, for example "password changed" after a rejected set-password] → Out of scope, flagged for a separate fix.
- [The best-effort write loses events during a Mongo outage] → Every loss is logged and sent to Sentry with action and correlation ID. A hanging Mongo no longer stalls auth responses beyond the 2 s budget.
- [The attempted email of a failed sign-in may belong to no user (PII of a non-user)] → Bounded retention, admin-only access, documented.
- [`AllExceptionFilter` is shared by every app] → `AuditService` is `@Optional`, and recording happens only when `req.audit` is set, which only `apps/api`'s guard does, so other apps are unaffected.
- [Global guard order is registration order] → `AuditContextGuard` must be listed before `MicroserviceAuthGuard`. A unit test asserts the `AppModule` provider order.

## Migration Plan

1. Deploy with `AUDIT_RETENTION_DAYS` set, or rely on the default of 365. No database migration is needed: Mongoose creates the `audit_events` collection and its indexes on startup.
2. Rollback: redeploy the previous release. The `audit_events` collection is left behind, harmless, and expires on its own.
