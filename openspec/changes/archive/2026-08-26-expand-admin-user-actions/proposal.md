## Why

The admin dashboard's `/users` screen only exposes a subset of the better-auth admin plugin: list, create, set role, ban/unban, delete. There is no way to inspect a single user's full state (sessions, ban details), no way for an admin to set a user's password directly, no way to impersonate a user for support/debugging, and `banUser` cannot record a reason or an expiry. These are all first-class better-auth admin capabilities already reachable through the `adminClient()` plugin already registered in `apps/web`, just not wired up.

## What Changes

- Add a new admin-only route `/users/:id` showing full detail for one user (identity, ban state, active sessions).
- Add session management on that page: list a user's active sessions, revoke one session, revoke all sessions.
- Add an "Impersonate" action (`impersonateUser` / `stopImpersonating`) with a persistent, unmissable "viewing as {user}" indicator shown app-wide while an impersonation session is active, and a one-click "Stop impersonating" control. An admin cannot impersonate another admin or themselves.
- Add a "Set password" action (`setUserPassword`) that lets an admin set a user's password directly, no reset-email flow. The affected user is notified their password changed, reusing the existing `emitUserPasswordChanged` notification path (**BREAKING** in scope only in the sense that this event now also fires from an admin-initiated action, not just self-service).
- Extend the existing `banUser` action (currently called with only `userId`) to collect an optional ban reason and an optional expiry duration, and display both wherever ban state is shown.
- The `/users` list keeps its current row actions but rows also link through to `/users/:id` for the new capabilities above.

Custom/granular access control (roles and permissions beyond the existing `admin`/`user` binary) is explicitly out of scope for this change — see Non-goals.

## Capabilities

### New Capabilities

(none — this extends the existing admin dashboard capability, it does not introduce a new bounded domain)

### Modified Capabilities

- `angular-web-app`: adds the `/users/:id` route and its admin-only enforcement, extends the "Administrators can manage user accounts" requirement to cover session management, impersonation, direct password setting, and ban reason/expiry.

## Impact

- `apps/web`: new route + component (`features/users/user-detail` or similar), new dialogs (set password, ban with reason/expiry, impersonate confirmation), an app-wide impersonation banner in the shell, extended `authClient.admin.*` usage (`getUser`, `listUserSessions`, `revokeUserSession`, `revokeUserSessions`, `impersonateUser`, `stopImpersonating`, `setUserPassword`), updated `ban()` call site and its dialog.
- `packages/shared-types`: schemas for the new admin action payloads (set password, ban reason/expiry, session list item) alongside the existing `user.schema.ts`.
- `apps/auth`: no server-side plugin config change expected — the `admin()` plugin already exposes all of the above by default for users with the `admin` role (see `apps/auth/src/app.module.ts`). Only the `emitUserPasswordChanged` publish path is touched, and it already exists.
- No database schema changes — all fields (`banReason`, `banExpires`, sessions table) are already part of better-auth's own schema.

## Non-goals

- Custom/granular access control (`createAccessControl`, custom roles beyond `admin`/`user`) — deferred.
- Auditing/history UI for admin actions (who impersonated whom, when a password was reset) beyond the existing notification-on-password-change path — no new audit log storage is introduced here.
- Bulk actions (bulk ban, bulk delete) — out of scope, this change is about single-user detail and actions.
- Custom fields on `updateUser` — not requested, `setRole`/`setUserPassword`/`banUser` cover the requested actions.

## Risks & Mitigations

- **Impersonation confusion**: an admin could forget they're impersonating and act as the user. Mitigated by a persistent, always-visible banner (not just a toast) rendered by the shell for the duration of the impersonation session, with a single always-reachable "Stop impersonating" control.
- **Privilege escalation via impersonation**: an admin impersonating another admin would inherit admin capabilities under someone else's identity. Mitigated by disallowing impersonation of any user whose role is `admin`, enforced client-side (menu/button disabled) — same trust boundary the existing self-action guards (`user.id === currentUserId()`) already rely on, since the actual authorization backstop is the better-auth server, not the UI.
- **Silent password takeover**: an admin setting a user's password without their knowledge. Mitigated by always emitting the existing `emitUserPasswordChanged` notification so the user is informed by email regardless of who changed it.

## Alternatives considered

- **Route the new actions through a custom NestJS controller in `apps/api` instead of calling `authClient.admin.*` directly**: rejected — the better-auth admin plugin already exposes authenticated, authorized endpoints for every action requested here; adding a proxy layer would duplicate authorization logic for no benefit, and the existing `/users` screen already talks to `apps/auth` directly the same way.
- **Skip the reason/expiry fields on `banUser` and file it as a separate change**: rejected — it is the same dialog and the same plugin call already being touched by this change, splitting it only adds review overhead.
