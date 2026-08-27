## Context

`apps/web` already registers `adminClient()` (see `apps/web/src/app/auth/auth-client.ts`) and `apps/auth` already registers the server-side `admin()` plugin with no custom options (`apps/auth/src/app.module.ts:41`) — every action below is already reachable through `authClient.admin.*` with no server config change. `/users` (`apps/web/src/app/features/users/users.ts`) already implements `listUsers`, `createUser`, `setRole`, `banUser` (without reason/expiry), `unbanUser`, `removeUser`, each following the same pattern: a `MatDialog` for input, an `injectMutation`/direct call, a `queryClient.invalidateQueries(['admin', 'users'])` on success, a `MatSnackBar` for the outcome. This design extends that pattern rather than introducing a new one. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Reuse the existing dialog/mutation/snackbar/invalidate pattern for every new action instead of inventing a second pattern.
- Make impersonation state impossible to miss, from any route, without a global state library — the app already has no store beyond `SessionService`'s signal bridge and `@tanstack/angular-query-experimental`.
- Keep every new client-side guard (self-impersonation, admin-impersonation) understood as UX only — better-auth is the actual authorization boundary.

**Non-Goals:**
- No custom access control (`createAccessControl`) — confirmed out of scope in proposal.md.
- No new NestJS controller/DTO in `apps/api` — the admin plugin's own REST surface is used directly from `apps/web`, same as today.
- No Prisma migration — `banReason`, `banExpires`, the sessions table, and `session.impersonatedBy` already exist in better-auth's own schema (`packages/database/prisma/auth.prisma`, not owned by this app).

## Decisions

### Route and component shape

Add `/users/:id` as a child of the same admin-gated parent route as `/users` in `apps/web/src/app/app.routes.ts`, `canActivate: [adminGuard]`, lazy-loaded like every other route. A new `features/users/user-detail/user-detail.ts` component owns:
- `getUser({ query: { id } })` via `injectQuery`, keyed `['admin', 'users', 'detail', id]`.
- `listUserSessions({ userId: id })` via `injectQuery`, keyed `['admin', 'users', 'sessions', id]`.

Rows in `users.ts`'s table become links to `/users/:id` (Material's row click or a dedicated "View" menu item — implementation detail for tasks.md) rather than replacing the existing menu actions, so the fast ban/unban/delete/edit-role actions stay available from the list without a navigation round-trip.

**Alternative considered**: fold everything into a `MatDialog` instead of a route, matching the create/edit dialogs. Rejected — sessions + impersonation + password + ban detail is enough content that a dedicated page reads better than a modal, and a bookmarkable/shareable `/users/:id` URL is consistent with `angular-web-app`'s existing "path-based URLs, no fragments" requirement.

### Ban dialog gains optional fields

Reuse `create-user-dialog`'s dialog pattern: extend the ban flow (currently a bare `ConfirmDialog` in `users.ts:159`) into a small form dialog with optional `reason` (text) and `expiresIn` (a duration picker — e.g. "Never" / 1 day / 7 days / 30 days, converted to seconds for `banExpiresIn`). Add `banUserSchema` to `packages/shared-types/src/schemas/user.schema.ts` (`reason: z.string().optional()`, `expiresInSeconds: z.number().int().positive().optional()`) validated with `zodValidator()`, matching every other form in the app. The dialog is reused from both `/users` (quick ban) and `/users/:id` (ban with full context visible).

### Set password

New `set-password-dialog` under `features/users/user-detail/`, same shape as `create-user-dialog` minus the reveal step (the admin chooses the password, doesn't need it echoed back). Add `setUserPasswordSchema` to `user.schema.ts` reusing the existing `min(8, 'Password must be at least 8 characters')` rule from `auth.schema.ts`'s `signInSchema` — the same policy, not a new one. Calls `authClient.admin.setUserPassword({ userId, newPassword })`. No server-side change needed for the `emitUserPasswordChanged` notification: `LocalAuthService`'s existing `AfterHook('/change-password')` only fires for self-service change-password, so admin-initiated `setUserPassword` needs its own `AfterHook('/admin/set-user-password')` in `apps/auth/src/local-auth.service.ts`, reusing `notificationsPublisher.emitUserPasswordChanged` exactly like the existing hook does (same call, different trigger).

### Sessions section

A simple table on `/users/:id`: session identifier (truncated), created/expires timestamps, and a "Revoke" button per row calling `revokeUserSession({ sessionToken })`, plus a "Revoke all" button calling `revokeUserSessions({ userId })`. Both invalidate the sessions query key on success. No new schema needed in `shared-types` beyond a `userSessionSchema` mirroring the fields better-auth's session table already returns (`id`, `token`, `createdAt`, `expiresAt`, `ipAddress`, `userAgent` — nullish where better-auth allows null).

### Impersonation

- **Detection**: better-auth's admin plugin adds `impersonatedBy` to the session record; while impersonating, the session payload's `session.impersonatedBy` is the original admin's user id (confirm the exact field against `packages/database/prisma/auth.prisma` at implementation time — that file is the source of truth for the schema per this repo's conventions, not this doc). `SessionService` gets a new `readonly isImpersonating = computed(() => !!this.state().data?.session?.impersonatedBy)`.
- **Banner**: `shell.ts`/`shell.html` (the layout every authenticated route renders inside, per `app.routes.ts`) renders a fixed banner when `session.isImpersonating()` is true, showing the impersonated user's name/email and a "Stop impersonating" button calling `authClient.admin.stopImpersonating()` then navigating to `/users`. This guarantees visibility from every route without touching each feature component.
- **Starting impersonation**: a button on `/users/:id`, disabled when the viewed user is the current admin (`user.id === currentUserId()`, the same guard `users.ts` already uses) or when the viewed user's role is admin. better-auth already refuses to impersonate an admin server-side by default (the admin plugin only grants the `impersonate-admins` permission to a role that explicitly requests it, which this change does not) — the client-side disable is UX on top of an enforcement that already exists, not a new trust boundary.
- **Confirmation**: given impersonation direclty logs the admin in as someone else, reuse `ConfirmDialog` before calling `impersonateUser` — consistent with how `ban()`/`delete()` already gate destructive/high-impact actions in `users.ts`.

### Shared-types additions

All new payload/response shapes go in `packages/shared-types/src/schemas/user.schema.ts` next to `userSchema`, following its existing documentation style (why a field is typed the way it is, referencing the better-auth wire shape where non-obvious):
- `banUserSchema` (`reason?`, `expiresInSeconds?`)
- `setUserPasswordSchema` (`newPassword`)
- `userSessionSchema` / `userSessionsListResponseSchema`
- Extend `userSchema` itself with `banReason: z.string().nullish()` and `banExpires: z.date().nullish()` (better-auth already returns these on `getUser`/`listUsers`; they're just not modeled yet).

## Risks / Trade-offs

- **[Risk]** A new `AfterHook('/admin/set-user-password')` in `apps/auth` is unverified against the plugin's actual hook path name → **Mitigation**: confirm the exact endpoint path against `auth.api` at implementation time (tasks.md includes a task to verify this against a running `apps/auth` instance, the same way `user.schema.ts`'s existing comment about `createdAt` parsing was verified live).
- **[Risk]** The impersonation banner adds always-mounted state to `shell.ts` → **Mitigation**: it's a single computed signal read, no new subscription beyond the one `SessionService` already holds.
- **[Trade-off]** Routing to `/users/:id` instead of a dialog is a larger diff than a modal would be → accepted, justified above under "Route and component shape".

## Migration Plan

No backend migration. Deploy is a normal `apps/web` (and, for the one `AfterHook` addition, `apps/auth`) release; both are already independently deployed per the existing nginx sub-domain topology. Rollback is a normal revert — no persisted state introduced by this change outside better-auth's own tables.
