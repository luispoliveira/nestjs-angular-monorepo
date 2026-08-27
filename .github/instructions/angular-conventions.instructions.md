---
description: 'Use when creating or modifying Angular frontend code. Covers standalone-component patterns, TanStack Query usage, authentication with better-auth, routing, and UI conventions for the web app.'
applyTo: 'apps/web/**/*.ts'
---

# Angular Frontend Conventions

## Tech Stack

- **Framework**: Angular 22, standalone components only — no `NgModule`s
- **Styling**: Tailwind CSS v4 + Angular Material
- **Data fetching**: `@tanstack/angular-query-experimental` (`injectQuery`/`injectMutation`), 60s default `staleTime`
- **Auth client**: vanilla `better-auth/client` (framework-agnostic — there is no `better-auth/angular` package), wrapped by the `AUTH_CLIENT` `InjectionToken`
- **Forms**: Angular reactive forms + `zodValidator()` from `@repo/shared-types`
- **Themes**: signal-backed `ThemeService` (persists to `localStorage`) + an inline pre-bootstrap script in `index.html`
- **Notifications**: `MatSnackBar`
- **State**: signals for local/derived state; no NgRx or a Signals Store — server state lives in TanStack Query, not duplicated into a store

## Project Structure

```
src/app/
  app.config.ts        # ApplicationConfig — providers (router, TanStack Query, error listeners)
  app.routes.ts         # Route table — lazy-loaded feature routes, guards
  app.ts                # Root component (just <router-outlet />)
  query-client.ts        # createQueryClient() — the shared TanStack QueryClient factory
  auth/
    auth-client.ts        # createAuthClient() instance
    auth-client.token.ts  # AUTH_CLIENT InjectionToken — the DI seam for testing
    session.service.ts    # Signal bridge over authClient.useSession (nanostores atom)
    auth.guard.ts          # authGuard, guestGuard (functional CanActivateFn)
    admin.guard.ts          # adminGuard (role check)
  theme/
    theme.service.ts       # Signal-backed theme mode, persisted to localStorage
  shell/
    shell.ts               # Authenticated app shell — sidenav, top bar, nav filtered by role
  features/
    <feature>/
      <feature>.ts            # Standalone component (+ .html, .scss, .spec.ts)
      <sub-dialog>/            # A MatDialog opened by the feature, own folder
```

Internal packages use the `@repo/` prefix — the same schemas the backend validates with:

```typescript
import { RoleEnum, createUserSchema, zodValidator } from '@repo/shared-types';
```

## Standalone components, not NgModules

Every component declares its own `imports: [...]` array. There is no root `AppModule` — bootstrap is `bootstrapApplication(App, appConfig)` in `main.ts`. Never introduce an `NgModule` to group providers or declarations; use `providers` in `app.config.ts` (app-wide) or a route's own providers (route-scoped) instead.

## Signals over RxJS for component state

Prefer `signal()`/`computed()` for local and derived state. RxJS is still the right tool for event streams that need operators (`debounceTime`, `distinctUntilChanged` on a search input's `valueChanges`) — bridge the result back into a signal rather than keeping template bindings on an `Observable` (no `async` pipe convention in this codebase).

## Authentication

```typescript
// Component / guard
private readonly session = inject(SessionService);
if (!this.session.isAuthenticated()) { ... }

// Functional guard — never a class-based guard
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  await session.ready(); // resolves once the session's first fetch has completed
  return session.isAuthenticated() ? true : router.parseUrl('/sign-in');
};
```

`SessionService` bridges better-auth's session nanostores atom (`authClient.useSession`) to an Angular signal — there is no `better-auth/angular` package, so every other better-auth client method (`signIn.email`, `admin.listUsers`, …) is used directly via the injected `AUTH_CLIENT` token. A guard **must** call `session.ready()` before deciding — never render or redirect against the atom's still-loading initial value.

Components and services inject `AUTH_CLIENT`, never the `authClient` singleton directly — that is the seam that lets a test substitute a fake client (see any `*.spec.ts` under `features/` for the pattern: `{ provide: AUTH_CLIENT, useValue: { admin: { listUsers: vi.fn() } } }`).

> **Never** implement custom session management or JWT handling. Always go through `AUTH_CLIENT`/`SessionService`.

## Role-Based Access

Use `RoleEnum` from `@repo/shared-types`:

```typescript
import { RoleEnum } from '@repo/shared-types';

if (this.session.user()?.role !== RoleEnum.ADMIN) { ... }
```

## Forms

Reactive forms validated by `zodValidator(schema)` — the same Zod schema the backend validates with. A field-level error reads from `control.errors?.['zod']` (a plain string message, set by the validator on each child control by path).

```typescript
protected readonly form = this.formBuilder.nonNullable.group(
  { name: [''], email: [''], role: [RoleEnum.USER] },
  { validators: zodValidator(createUserSchema) },
);
```

```html
@if (form.controls.email.errors?.['zod']; as message) {
  <mat-error>{{ message }}</mat-error>
}
```

## Data fetching — TanStack Query

Use `injectQuery`/`injectMutation` from `@tanstack/angular-query-experimental`, never a hand-rolled `HttpClient` call + signal. The `queryFn` throws on a better-auth `error` response and re-`parse()`s the payload through its shared Zod response schema (from `@repo/shared-types`) before returning — never hand an unvalidated network payload to a template.

```typescript
protected readonly usersQuery = injectQuery(() => ({
  queryKey: ['admin', 'users', 'list', query],
  queryFn: async () => {
    const { data, error } = await this.authClient.admin.listUsers({ query });
    if (error) throw new Error(error.message ?? 'Failed to load users.');
    return usersListResponseSchema.parse(data);
  },
}));
```

After a mutation succeeds, invalidate the affected query key via the injected `QueryClient` (`inject(QueryClient)` from the same package) — do not manually patch cached data.

## UI Components

- Angular Material owns component surfaces (`MatDialog`, `MatTable`, `MatMenu`, `MatSnackBar`, form fields) — do not hand-roll these or reach for a second component library.
- Tailwind utility classes own layout (flex/grid, spacing, width). When the two disagree on a Material component's own sizing, the fix belongs in that component's SCSS as a plain rule, not a Tailwind class: Material's own injected CSS is not wrapped in Tailwind's `@layer utilities`, so an unlayered Tailwind class loses the cascade regardless of specificity.
- Icons: `<mat-icon>name</mat-icon>` (Material icon font ligatures) — no separate icon package.

```typescript
import { MatDialog } from '@angular/material/dialog';

protected openCreateUserDialog(): void {
  this.dialog.open(CreateUserDialog);
}
```

## Routing & Guards

- Feature routes are lazy-loaded (`loadComponent`) under a parent route that renders the `Shell` and carries `authGuard`; admin-only routes additionally carry `adminGuard`.
- Guards are functions (`CanActivateFn`), never classes implementing `CanActivate`.
- Redirects live in the guard itself (`router.parseUrl(...)`), not in a route resolver or a component's constructor.

```typescript
export const routes: Routes = [
  { path: 'sign-in', loadComponent: () => import('./features/sign-in/sign-in').then((m) => m.SignIn), canActivate: [guestGuard] },
  {
    path: '',
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'users', loadComponent: () => import('./features/users/users').then((m) => m.Users), canActivate: [adminGuard] },
    ],
  },
];
```

## Theming

`ThemeService` owns a `mode` signal (`'light' | 'dark'`), persisted to `localStorage` under the key `theme-mode`. `src/index.html` has a small inline `<script>` that reads the same key and sets `document.documentElement.style.colorScheme` **before** Angular bootstraps, so there is no flash of the wrong theme on load — keep that script's storage key in sync with `ThemeService.THEME_STORAGE_KEY` if either changes. An unreadable/corrupt stored value must fall back to `'light'` without throwing (wrap the read in `try`/`catch`).

## Security Considerations

- Never expose secrets or API keys in component code — build-time config comes from `webConfig` (`apps/web/src/app/config/app-config.ts`), itself Zod-validated at module load from the environment file baked in via `angular.json`'s `fileReplacements`.
- `generatePassword()` (inlined in `create-user-dialog.ts`, the only place a password is generated client-side) uses `crypto.getRandomValues` — always prefer this over `Math.random()` for any secret/token material.
