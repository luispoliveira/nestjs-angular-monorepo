---
paths:
  - "apps/web/**"
---

## Angular Conventions (`apps/web`)

- **Standalone components** (no `NgModule`s) + signals for local/derived state + Tailwind v4 + Angular Material.
- Data fetching: `@tanstack/angular-query-experimental` (`injectQuery`/`injectMutation`), 60s default `staleTime`. `QueryClient` is provided once in `app.config.ts` via `provideTanStackQuery(createQueryClient())`.
- Forms: Angular reactive forms (`FormBuilder`/`FormGroup`) validated by `zodValidator(schema)` from `@repo/shared-types` — the same Zod schema the backend validates with. Field errors read from `control.errors?.['zod']` (a string).
- Network-boundary parsing: a query's `queryFn` throws on a better-auth `error`, then re-`parse()`s the response through its shared Zod response schema before returning it — never trust an unvalidated payload into a signal (design.md's `D6` in the Angular migration's archived openspec change).
- Theme: a `ThemeService` (signal-backed, persisted to `localStorage`) plus an inline pre-bootstrap script in `index.html` that applies the stored preference before Angular loads, avoiding a flash of the wrong theme. Toasts/snackbars: `MatSnackBar`.
- Routing: functional guards (`CanActivateFn`), never class-based guards. Protected routes await the session's first resolution (`SessionService.ready()`) before deciding — never render protected content against the session atom's still-loading initial value.

### Session and auth

```typescript
// Component
private readonly session = inject(SessionService); // signal-backed bridge over authClient.useSession
if (!this.session.isAuthenticated()) { ... }

// Guard
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  await session.ready();
  return session.isAuthenticated() ? true : inject(Router).parseUrl('/sign-in');
};
```

`AUTH_CLIENT` (an `InjectionToken` wrapping the vanilla `better-auth/client`) is the DI seam for testing — components inject `AUTH_CLIENT`, never `authClient` directly, so tests can substitute a fake client. **Never** write custom session/JWT logic.

For role checks: `session.user()?.role !== RoleEnum.ADMIN` (`RoleEnum` from `@repo/shared-types`).

### UI

- Angular Material owns component surfaces (dialogs, tables, menus, form fields); Tailwind utility classes own layout. When the two conflict on a Material component's own sizing, the fix goes in that component's SCSS as a plain (unlayered) rule — Material's injected CSS is not wrapped in Tailwind's `@layer utilities`, so an unlayered Tailwind class loses regardless of specificity.
- `MatDialog` for modals, `MatSnackBar` for toasts, `MatMenu` for action menus — do not hand-roll these.
- Icons: Material icon ligatures (`<mat-icon>name</mat-icon>`), not a separate icon package.
