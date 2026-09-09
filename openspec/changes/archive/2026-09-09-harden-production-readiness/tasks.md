## 1. Role-based authorization guard

- [x] 1.1 `packages/shared`: feat: add `ROLES_KEY` + `Roles(...roles: RoleEnum[])` decorator in `src/decorators/roles.decorator.ts`, exported from `src/decorators/index.ts` — verify it builds and is importable from `@repo/shared`
- [x] 1.2 `packages/shared`: feat: add `RolesGuard` in `src/guards/roles.guard.ts` — reads `ROLES_KEY` via `Reflector`, fail-open when absent, checks `request.user.role` against the allowed roles otherwise; export from `src/guards/index.ts`
- [x] 1.3 `packages/shared`: test: add `roles.guard.spec.ts` covering: no metadata → allowed; matching role → allowed; non-matching role → 403; verify `pnpm --filter @repo/shared test` passes
- [x] 1.4 `apps/api`: feat: register `RolesGuard` as a second `APP_GUARD` in `app.module.ts`, after `MicroserviceAuthGuard` — verify `pnpm --filter api build` succeeds and the existing `AppController` route still responds 200 unauthenticated-role-wise (no `@Roles()` on it yet)
- [x] 1.5 chore: commit this group's work using the `/commit` skill

## 2. Structured production logging

- [x] 2.1 `packages/shared`: fix: make `pinoConfig.pinoHttp.transport` `undefined` when `isProduction`, keep the existing `pino-pretty` options otherwise, in `src/logging/pino.config.ts`
- [x] 2.2 `packages/shared`: test: add/extend a spec asserting `pinoConfig` (or a small exported builder) has `transport === undefined` when `NODE_ENV=production` and a `pino-pretty` transport otherwise; verify `pnpm --filter @repo/shared test` passes
- [x] 2.3 chore: commit this group's work using the `/commit` skill

## 3. Scoped database seeding

- [x] 3.1 `packages/database`: refactor: create `DatabaseSeederModule` in `src/database-seeder.module.ts` importing `DatabaseModule` and providing `DatabaseSeederService`; remove `DatabaseSeederService` from `DatabaseModule`'s `providers` in `src/database.module.ts`; export `DatabaseSeederModule` from the package's `index.ts`
- [x] 3.2 `apps/api`: refactor: import `DatabaseSeederModule` in `app.module.ts` — verify `pnpm --filter api build` succeeds and the app boots locally with the existing seeding log lines appearing
- [x] 3.3 `packages/database`: test: verify `database-seeder.service.spec.ts` still passes unchanged (service behavior didn't change, only its module home) — verify `pnpm --filter @repo/database test` passes
- [x] 3.4 chore: verify no other app (`auth`, `notifications`, `worker`, `cron`) logs the seeder's startup message anymore — boot each locally or grep their compiled module graphs for `DatabaseSeederModule`/`DatabaseSeederService` and confirm absence
- [x] 3.5 chore: commit this group's work using the `/commit` skill

## 4. Deploy docs cleanup

- [x] 4.1 `DEPLOY.md`: docs: replace `tx_home`/`tx-home`/`TX Home` placeholders with a generic placeholder (e.g. `<app-name>` / `app_db`), remove the `UPLISTING_URL` and `PUBLIC_API_URL` rows and the "app falha ao iniciar" claim tied to them
- [x] 4.2 `DEPLOY-PM2.md`: docs: same replacements as 4.1, applied to this file's env tables and shell snippets
- [x] 4.3 chore: grep both files for `tx_home\|TX Home\|tx-home\|UPLISTING\|PUBLIC_API_URL` and verify zero matches remain
- [x] 4.4 chore: commit this group's work using the `/commit` skill

## 5. Final verification

- [x] 5.1 Run `pnpm build && pnpm lint && pnpm check-types && pnpm test` at the repo root and verify all pass
- [x] 5.2 Smoke test: boot `apps/api` locally, confirm it starts cleanly with the seeder module wired in and `RolesGuard` registered with no regressions on existing routes
