## Context

See `proposal.md` - Why. Three independent, small pieces of hardening bundled into one change because they surfaced from the same audit and touch mostly `packages/shared` and `packages/database`.

Relevant current state:
- `apps/api` and `apps/auth` each register their own request-level guard as `APP_GUARD` (`MicroserviceAuthGuard` in `api`, `@thallesp/nestjs-better-auth`'s `AuthGuard` in `auth`). Both already read `IS_PUBLIC_KEY` metadata via `Reflector` and skip enforcement when a route is `@Public()`.
- `MicroserviceAuthGuard` populates `request.user` from the auth service's `AUTH_AUTHENTICATE` response, which is `session.user` from better-auth — already includes `role` (better-auth's `admin()` plugin adds it to the user model), so no new data needs to flow anywhere for role checks to work.
- `packages/shared/src/logging/pino.config.ts` builds one `Params` object reused by every app's `LoggerModule.forRootAsync` (via `SharedModule.register()`); there is no per-app override today.
- `DatabaseModule` (`packages/database/src/database.module.ts`) is `@Global()` and lists `DatabaseSeederService` as a provider, so it is instantiated (and its `onModuleInit` runs) in every app that imports `SharedModule.register()` — i.e. all five NestJS apps.

## Goals / Non-Goals

**Goals:**
- Ship `RolesGuard`/`@Roles()` as reusable, correctly-scoped infrastructure in `packages/shared`, consistent with the existing `@Public()` pattern.
- Make the pino transport choice a pure function of `NODE_ENV`, no other behavior change.
- Make `apps/api` the only app where seeding can run, via module boundaries rather than a runtime check.

**Non-Goals:**
- Deciding *which* real routes need `@Roles(RoleEnum.ADMIN)` — none exist yet (see proposal's Non-goals).
- Introducing a permissions/ACL system beyond the existing binary `admin`/`user` `RoleEnum`.

## Decisions

### 1. `RolesGuard` is fail-open by default, mirroring `@Public()`
A route with no `@Roles()` metadata is allowed through unchanged — the guard only rejects when metadata is present and the authenticated user's role isn't in the allowed list. This mirrors how `MicroserviceAuthGuard`/`AuthGuard` already fail-open unless a route opts into stricter behavior (there, opting into public via `@Public()`; here, opting into a restriction via `@Roles()`).

**Alternative considered**: fail-closed (require `@Roles()` on every route, reject otherwise). Rejected — would break the entire existing `apps/api` surface the moment the guard is registered, since zero current routes declare any role metadata. Fail-open matches the actual maturity of the codebase (one boilerplate route today) without a forced migration.

### 2. `RolesGuard` reads `request.user.role`, set by the existing auth guard — no new data plumbing
Since `MicroserviceAuthGuard` already attaches `session.user` (role included) to `request.user`, `RolesGuard` only needs `Reflector` + that existing field. It must run *after* the authentication guard in the `APP_GUARD` provider order (Nest evaluates multiple `APP_GUARD`s in registration order, all must pass) — in `apps/api/src/app.module.ts`, register `RolesGuard` as a second `APP_GUARD` entry after `MicroserviceAuthGuard`.

**Alternative considered**: a combined `AuthAndRolesGuard` that does both checks in one class. Rejected — couples two already-separable concerns and would need duplicating auth logic per app; two small guards composed via multiple `APP_GUARD` providers is the smaller diff and matches the existing multi-guard pattern.

### 3. `@Roles(...roles: RoleEnum[])` decorator, `SetMetadata`-based, same shape as `@Public()`
`export const ROLES_KEY = 'ROLES'; export const Roles = (...roles: RoleEnum[]) => SetMetadata(ROLES_KEY, roles);` — accepts one or more roles (any-of match), imported from `@repo/shared-types`.

### 4. `pino.config.ts`: transport is `undefined` in production, `pino-pretty` options otherwise
```ts
transport: isProduction
  ? undefined
  : { target: 'pino-pretty', options: { ... same as today ... } },
```
No other field changes. When `transport` is `undefined`, `nestjs-pino`/pino falls back to its default JSON stdout writer — this is the standard way to toggle pino's transport and needs no new dependency.

### 5. `DatabaseSeederModule` is a plain (non-global) `@Module` in `packages/database`, imported directly by `apps/api`'s `AppModule`
`DatabaseModule` keeps providing/exporting only `DatabaseService`. `DatabaseSeederModule` imports `DatabaseModule` (for `DatabaseService`) and provides `DatabaseSeederService`. Because it's not `@Global()` and not part of `SharedModule.register()`, it only initializes where an app's own module graph imports it.

**Alternative considered**: keep `DatabaseSeederService` in `DatabaseModule` but guard its `onModuleInit` body with an injected app-name/flag. Rejected in the proposal already — still instantiates and logs in every app, just no-ops; a module boundary is the actual fix, not a runtime conditional bolted onto a global provider.

## Risks / Trade-offs

- **[Risk]** A future app other than `apps/api` needs seeding too, and a dev forgets to import `DatabaseSeederModule` there. → **Mitigation**: none needed structurally; this is the intended behavior (explicit opt-in). Document the pattern in the module's own file-level comment so the next dev copies it correctly.
- **[Risk]** Registering `RolesGuard` as a second global guard in `apps/api` adds a small amount of per-request overhead (one more `Reflector` lookup) even for the common case of no `@Roles()` metadata. → **Mitigation**: negligible — `Reflector.getAllAndOverride` is an in-memory metadata read, not I/O.
- **[Trade-off]** `apps/auth` is not touched by the `RolesGuard` wiring (admin routes there are better-auth's own plugin, already self-protecting) — if a future Nest-routed admin endpoint is ever added directly to `apps/auth` (not via the better-auth plugin), it would need its own `RolesGuard` registration, mirroring `apps/api`. Acceptable: out of scope until that endpoint exists (see proposal's Non-goals).

## Migration Plan

No data migration. Deploy order doesn't matter across apps — `RolesGuard`/`@Roles()` add no behavior until a route opts in; the logging change only affects log formatting; the seeder-module split only affects `apps/api`'s own boot (seeding stays a manual/explicit step there, same as `pnpm db:seed` today). Rollback is a plain revert — none of the three pieces has a forward-only side effect.
