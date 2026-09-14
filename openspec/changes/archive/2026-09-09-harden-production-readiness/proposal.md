## Why

A production-readiness audit of the template surfaced three concrete gaps that would bite on the first real deployment, plus one piece of leftover documentation from the project this template was extracted from:

1. No backend ever enforces `RoleEnum` — it is only checked in `apps/web` (Angular), which is trivially bypassed by calling the API directly. There is no `RolesGuard`/`@Roles()` in `packages/shared`.
2. `pino-pretty` is unconditionally active in every NestJS app, including production, contradicting `CLAUDE.md`'s own "JSON in prod" convention and breaking structured-log ingestion (Loki/ELK/CloudWatch).
3. `DEPLOY.md`/`DEPLOY-PM2.md` still reference a specific prior product (`tx_home`, "TX Home", an Uplisting integration) that has no corresponding code in this template, misleading anyone following the deploy guide literally.
4. `DatabaseSeederService` is a provider of the `@Global()` `DatabaseModule`, so it runs on `onModuleInit` of every app (auth, api, notifications, worker, cron) rather than only where seeding is meant to happen.

## What Changes

- Add `RolesGuard` + `@Roles()` decorator to `packages/shared` (guards/decorators), following the existing `@Public()` pattern, so the first real admin-only route in `apps/api` has infrastructure to enforce `RoleEnum` server-side.
- Make `pinoConfig`'s `pino-pretty` transport conditional on `!isProduction`; production emits plain JSON to stdout.
- Extract `DatabaseSeederService` out of `DatabaseModule` into a new, non-global `DatabaseSeederModule` in `packages/database`, imported only by `apps/api`. **BREAKING** for any other app that implicitly relied on the seeder running at boot (none do today — confirmed no other app depends on seeded data existing before its own `onModuleInit`).
- Replace `tx_home`/`TX Home`/`tx-home` placeholders in `DEPLOY.md` and `DEPLOY-PM2.md` with generic placeholders, and remove the `UPLISTING_URL`/`PUBLIC_API_URL` rows and their "the app fails to start without this" claim, since no code in this template references them.

## Capabilities

### New Capabilities

- `role-based-authorization`: `RolesGuard` + `@Roles()` decorator in `packages/shared`, enforcing `RoleEnum` server-side on any route that opts in — the backend counterpart to the existing frontend-only role checks.
- `structured-production-logging`: pino emits structured JSON in production (no `pino-pretty` transport), while dev keeps the current pretty/colorized output.
- `scoped-database-seeding`: seeding runs only where explicitly wired (`apps/api`), never as a side effect of every app's boot.

### Modified Capabilities

*(none — no existing spec-level behavior changes; the deploy-docs cleanup is documentation only, see Non-goals)*

## Impact

- `packages/shared`: new `RolesGuard` (`src/guards`), new `@Roles()` decorator (`src/decorators`), both exported from the package's `index.ts`; `pino.config.ts` transport made environment-conditional.
- `packages/database`: new `DatabaseSeederModule` (`src/database-seeder.module.ts`), `DatabaseSeederService` removed from `DatabaseModule`'s `providers`.
- `apps/api`: imports the new `DatabaseSeederModule` in its `AppModule`.
- `DEPLOY.md`, `DEPLOY-PM2.md`: text-only edits, no code impact.
- No database migrations, no breaking API surface for the frontend.

## Non-goals

- Wiring `RolesGuard`/`@Roles()` onto any real route — no admin-only backend endpoint exists yet in `apps/api` to protect. This change ships the guard as reusable infrastructure only.
- Writing actual seeders — `packages/database/src/seeders/` stays empty; this change only fixes *where* seeding is allowed to run.
- Database backup/restore strategy — handled externally via databasus.com, out of scope here.
- Any other production-readiness gap surfaced by the audit (test coverage gaps, missing Bull dashboard, Redis separation, health-check coverage, docker-compose production services, pre-commit hooks) — deferred to future changes.

## Risks & Mitigations

- **Risk**: a `RolesGuard` registered globally (as `APP_GUARD`) could accidentally lock out routes that never declare `@Roles()`. **Mitigation**: guard is fail-open when no `@Roles()` metadata is present (mirrors how `AuthGuard` + `@Public()` already behave) — documented and enforced in `design.md`.
- **Risk**: removing `DatabaseSeederService` from `DatabaseModule` could break something that unknowingly depended on it running globally. **Mitigation**: confirmed via grep that `DatabaseSeederService` has no consumers today and is a no-op (`src/seeders/` is empty) — safe to move.
- **Risk**: docs cleanup could remove information someone still needs for their own fork. **Mitigation**: replace with generic placeholders rather than deleting the sections; only the two fully orphaned rows (`UPLISTING_URL`, `PUBLIC_API_URL`) are removed outright, since they reference nothing in code.

## Alternatives considered

- **Global `APP_GUARD` for `RolesGuard` vs. per-route `@UseGuards(RolesGuard)`**: deferred to `design.md` — both are viable, the proposal only commits to shipping the guard, not its exact registration.
- **Leaving `DatabaseSeederService` in `DatabaseModule` but adding a `NODE_ENV` guard inside it**: rejected — still runs (and logs) on every app boot, just no-ops in prod; a dedicated module scoped to `apps/api` is a smaller, clearer fix than a runtime conditional.
