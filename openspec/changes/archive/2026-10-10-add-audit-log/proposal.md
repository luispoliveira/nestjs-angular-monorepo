# Proposal

## Why

Nothing records who did what. Banning a user, changing a role, setting a password, impersonating, deleting an account or signing in leaves no trace: these actions go straight from `apps/web` to better-auth's routes in `apps/auth`, which run outside Nest's pipeline, so the Mongo request `Log` never sees them (verified: every one of its entries is `/api/v1/*`, none is `/api/auth/*`). That log also drops guard rejections (no 401/403 entries at all), keeps only 30 days, and stores sanitized HTTP payloads instead of "actor X did Y to Z". A backoffice template needs a real audit trail, both for security investigations and for answering "who changed this?".

## What Changes

- New append-only **audit event** store in MongoDB (its own collection, separate from the HTTP `Log`). Retention is set per environment with `AUDIT_RETENTION_DAYS` (default 365) and enforced per document.
- **`apps/auth`**: one global better-auth `after` hook records every allow-listed authentication and account-management endpoint, on success and on failure:
  - self-service: sign-in, sign-up, sign-out, password change and reset, email change and verification, profile update, account deletion, session revocation, 2FA enable/disable/backup codes/verification;
  - admin: create, update, remove, ban, unban, set role, set password, impersonate, stop impersonating, revoke sessions.
  - Read endpoints (`get-session`, `list-*`, `get-user`, …) are never recorded.
- **`apps/api`**: customer create, update and delete are recorded, including requests rejected by authentication or role checks.
- Each event records actor, `impersonatedBy` (the real admin during an impersonation), action, target, outcome (`success`/`failure` with error code), changed field names, values only for non-sensitive fields, IP, user agent and the request's correlation ID. Passwords, tokens, NIFs and email values are never stored as changed values. A failed sign-in records the attempted email.
- Writing an audit event is best-effort: a storage failure never fails or rolls back the user's action, and it is reported to logs and Sentry.
- **`apps/api`**: new admin-only, read-only endpoint `GET /api/v1/audit-events`, paginated and filterable by actor, target, action, outcome and date range.
- **`apps/web`**: new admin-only `/audit` page with a filterable, paginated table.

## Capabilities

### New Capabilities

- `audit-log`: recording of authentication, account-management and business write events. Covers what is recorded, the event content and its privacy limits, outcome on failure, retention, the best-effort write guarantee, immutability, and the admin-only query API and UI.

### Modified Capabilities

None. The HTTP request log (`structured-production-logging`) is unchanged, and audit events link to it only through the correlation ID. `role-based-authorization` and `customer-management` behave as specified; the audit observes them without changing their outcomes.

## Non-goals

- Fixing the HTTP request `Log`'s blind spots (better-auth routes, 401/403). The audit covers those events itself; changing the request log is a separate change.
- Tamper-evidence (hash chains, WORM storage) or shipping events to an external SIEM.
- Users viewing their own activity (e.g. on `/account`).
- Export (CSV) of audit events.
- Auditing read access (who viewed which customer).
- Alerting on suspicious patterns (e.g. repeated failed sign-ins). The data supports it later.
- Erasing a deleted user's past audit events before retention expires (documented as a retention trade-off).

## Open questions

None open. Resolved during explore and the proposal check:

- Scope: everything above, including self-service and sign-ins.
- Storage: Mongo, its own collection, `AUDIT_RETENTION_DAYS` with a default of 365.
- Failures: recorded with `outcome=failure`. A failed sign-in keeps the attempted email, never the password.
- Detail: changed field names, plus values only for non-sensitive fields.
- Viewer: `/audit` for admins only, append-only.
- Write failure: best-effort.
- Impersonation: `actor` is the impersonated user and `impersonatedBy` is the admin.
- Sessions: only sign-in, sign-out and 2FA verification. `get-session` is never recorded.

## Alternatives considered

- **Extend the `LoggingInterceptor`.** Rejected: it cannot see better-auth's routes or guard rejections, it records every read, and answering "who banned X?" would mean parsing URLs and bodies.
- **Postgres table.** Transactional with business writes and joinable, but auth events have no business transaction to join, and an append-heavy, retention-bound stream fits Mongo, which the project already reserves for logs and audit.
- **One `@AfterHook` per better-auth route.** About 30 methods, and a newly used endpoint would silently go unaudited. A single global `after` hook with a path allow-list keeps the list in one place.
- **Publishing events over Redis to a consumer.** Decouples writes, but adds a hop and a failure mode for no gain at this volume.

## Risks & Mitigations

- **Sign-in volume dominates storage.** Mitigation: per-document TTL (`expireAt`), an index on the query filters, and reads excluded from the allow-list.
- **A best-effort write can lose events silently.** Mitigation: every failed write is logged and sent to Sentry with the action and correlation ID.
- **PII in audit events (emails, IPs, attempted emails).** Mitigation: values are stored only for an allow-list of safe fields, retention is bounded, and the page is admin-only. The retention trade-off for deleted users is documented.
- **better-auth endpoint paths can change between versions.** Mitigation: the allow-list is a single constant, a unit test covers the mapping, and the integration test exercises real routes.
- **The changed-TTL index conflict** (changing the retention of an existing TTL index fails or is ignored). Mitigation: each document carries its own `expireAt`, indexed with `expireAfterSeconds: 0`.

## Impact

- `packages/shared`: new audit event schema, `AuditService` (best-effort write and query), constants (`AUDIT_ACTIONS`, safe-field allow-list), Mongo module registration, and a decorator/interceptor for API writes.
- `packages/shared-types`: audit event response and query schemas shared with the web.
- `apps/auth`: global better-auth `hooks.after`, plus `AUDIT_RETENTION_DAYS` in its env schema.
- `apps/api`: auditing of customer writes and guard rejections, `GET /api/v1/audit-events`, plus `AUDIT_RETENTION_DAYS` in its env schema.
- `apps/web`: `/audit` route, admin nav entry and page.
- `README.md` / `.env.example`: the new variable and the retention note.
- No new runtime dependencies.
