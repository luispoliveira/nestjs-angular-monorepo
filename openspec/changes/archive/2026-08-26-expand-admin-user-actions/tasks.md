## 1. Shared schemas

- [x] 1.1 packages/shared-types: extend `userSchema` in `user.schema.ts` with `banReason: z.string().nullish()` and `banExpires: z.date().nullish()`; verify existing `Users` consumers still type-check (`pnpm check-types`)
- [x] 1.2 packages/shared-types: add `banUserSchema` (`reason?: z.string()`, `expiresInSeconds?: z.number().int().positive()`) to `user.schema.ts`
- [x] 1.3 packages/shared-types: add `setUserPasswordSchema` (`newPassword: z.string().min(8, ...)`, reusing `signInSchema`'s password rule) to `user.schema.ts`
- [x] 1.4 packages/shared-types: add `userSessionSchema` and `userSessionsListResponseSchema` mirroring better-auth's session fields (`id`, `token`, `createdAt`, `expiresAt`, `ipAddress`, `userAgent`)
- [x] 1.5 packages/shared-types: `test:` add unit tests for the four new/extended schemas covering valid input, missing required fields, and optional-field omission; verify `pnpm --filter @repo/shared-types test` passes

## 2. apps/auth: admin-initiated password change notification

- [x] 2.1 apps/auth: confirm the exact `AfterHook` path for `authClient.admin.setUserPassword` against a running `apps/auth` instance (mirrors the existing verified-live comment on `user.schema.ts`'s `createdAt` handling) — confirmed by reading better-auth's own source (`plugins/admin/routes.mjs`): endpoint is `POST /admin/set-user-password`, body is `{ userId, newPassword }`
- [x] 2.2 apps/auth: `feat:` add the confirmed `AfterHook` in `local-auth.service.ts` calling `notificationsPublisher.emitUserPasswordChanged` with reason `'Password set by an administrator'`, following the existing `handlePasswordChanged` pattern
- [x] 2.3 apps/auth: `test:` add a unit test on `local-auth.service.spec.ts` asserting the new hook emits `emitUserPasswordChanged` with the affected user's id/email; verify `pnpm --filter auth test` passes

## 3. apps/web: impersonation session detection and banner

- [x] 3.1 apps/web: `feat:` add `isImpersonating` computed signal to `SessionService`, derived from the session payload's impersonation field confirmed in design.md
- [x] 3.2 apps/web: `test:` add a unit test for `SessionService.isImpersonating` covering both impersonating and normal session states
- [x] 3.3 apps/web: `feat:` add a persistent banner to `shell.html`/`shell.ts`, visible whenever `isImpersonating()` is true, showing the impersonated user's name/email and a "Stop impersonating" button calling `authClient.admin.stopImpersonating()` then navigating to `/users`
- [x] 3.4 apps/web: `test:` add a component test asserting the banner renders only while impersonating and that "Stop impersonating" calls the client and navigates; verify `pnpm --filter web test` passes for `shell.spec.ts`

## 4. apps/web: user detail route and identity view

- [x] 4.1 apps/web: `feat:` add `/users/:id` to `app.routes.ts` as an admin-gated (`canActivate: [adminGuard]`) lazy-loaded child route, alongside `/users`
- [x] 4.2 apps/web: `feat:` create `features/users/user-detail/user-detail.ts` + `.html` rendering identity (name, email, createdAt), role, and ban state (reason/expiry when present), backed by `getUser({ query: { id } })` via `injectQuery`
- [x] 4.3 apps/web: `feat:` handle the not-found case (server error from `getUser`) with an error state instead of the detail view
- [x] 4.4 apps/web: `test:` add `user-detail.spec.ts` covering identity rendering, ban-state display with and without reason/expiry, and the not-found error state; verify `pnpm --filter web test` passes
- [x] 4.5 apps/web: `feat:` link each row in `users.ts`'s table to `/users/:id` and verify navigation with a component test

## 5. apps/web: ban dialog with reason and expiry

- [x] 5.1 apps/web: `refactor:` extend the ban flow (currently `ConfirmDialog` in `users.ts`) into a form dialog collecting optional reason and expiry, validated with `zodValidator(banUserSchema)`
- [x] 5.2 apps/web: `feat:` wire the extended dialog into both `/users`' quick-ban action and `/users/:id`'s ban action, calling `authClient.admin.banUser({ userId, banReason, banExpiresIn })`
- [x] 5.3 apps/web: `feat:` display ban reason/expiry on both the `/users` table's status cell and `/users/:id`'s ban-state section
- [x] 5.4 apps/web: `test:` cover ban-with-reason, ban-without-reason, and unban clearing the displayed reason/expiry; verify `pnpm --filter web test` passes

## 6. apps/web: session management

- [x] 6.1 apps/web: `feat:` add a sessions table to `user-detail.ts`/`.html` backed by `listUserSessions({ userId })` via `injectQuery`, keyed `['admin', 'users', 'sessions', id]`
- [x] 6.2 apps/web: `feat:` add a per-row "Revoke" action calling `revokeUserSession({ sessionToken })`, invalidating the sessions query on success
- [x] 6.3 apps/web: `feat:` add a "Revoke all" action calling `revokeUserSessions({ userId })`, invalidating the sessions query on success
- [x] 6.4 apps/web: `test:` cover session list rendering, single revoke removing a row, and revoke-all emptying the list; verify `pnpm --filter web test` passes

## 7. apps/web: set password

- [x] 7.1 apps/web: `feat:` create `set-password-dialog` under `features/users/user-detail/`, validated with `zodValidator(setUserPasswordSchema)`, calling `authClient.admin.setUserPassword({ userId, newPassword })`
- [x] 7.2 apps/web: `feat:` wire the dialog to a "Set password" action on `/users/:id`
- [x] 7.3 apps/web: `test:` cover successful submission, password-policy validation error, and server-error handling; verify `pnpm --filter web test` passes

## 8. apps/web: impersonation action

- [x] 8.1 apps/web: `feat:` add an "Impersonate" action on `/users/:id`, disabled when the viewed user's id equals the current admin's id or the viewed user's role is admin
- [x] 8.2 apps/web: `feat:` gate the action behind `ConfirmDialog` before calling `authClient.admin.impersonateUser({ userId })`, then navigate to `/dashboard`
- [x] 8.3 apps/web: `test:` cover the action being disabled for self and for admin users, and enabled+working for a regular user; verify `pnpm --filter web test` passes

## 9. Verification

- [x] 9.1 Update `openspec/specs/angular-web-app/spec.md` is left untouched (delta lives in this change) — confirm `openspec validate expand-admin-user-actions --strict` passes
- [x] 9.2 Run `pnpm build && pnpm lint && pnpm check-types` across the monorepo and fix any fallout
- [x] 9.3 Manual end-to-end smoke test against a running stack — done at the **API level** against a live `apps/auth` + real Postgres (docker-compose infra), exercising every new/changed better-auth endpoint through raw HTTP as an admin: create → ban with reason/expiry → getUser reflects both → unban clears them → setUserPassword (confirmed the `handleAdminSetPassword` `AfterHook` fires with the *target* user's id/email, not the admin's) → listUserSessions/revokeUserSession/revokeUserSessions → impersonateUser/stopImpersonating (confirmed `get-session` reflects `impersonatedBy` while impersonating and reverts on stop) → confirmed the server itself returns 403 `YOU_CANNOT_IMPERSONATE_ADMINS` when targeting an admin. **Not done**: a real browser click-through of the Angular UI — the Claude in Chrome extension was unavailable in this session (not connected), so `/users/:id`'s rendering, the impersonation banner, and dialog interactions are verified only by the component test suite (`pnpm --filter web test`, 68/68 passing) plus a successful `ng serve` build with no console errors, not by an actual browser. Flagging this gap rather than claiming a full manual check.
