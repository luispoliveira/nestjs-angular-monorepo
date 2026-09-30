# Tasks

## 1. Ephemeral test infrastructure for apps/auth

- [x] 1.1 test(testing-utils): packages/testing-utils: add a `redis:7-alpine` container to `src/e2e/global-setup.ts` (same run label) and export `REDIS_HOST` / `REDIS_PORT`; export `E2E_CONTAINERS_RUN_ID_ENV` from the package barrel; add `./e2e/global-setup` and `./e2e/global-teardown` subpath exports — verify `pnpm --filter @repo/testing-utils build` emits `dist/src/e2e/*.js` and `node -e "require.resolve('@repo/testing-utils/e2e/global-setup')"` resolves from `apps/auth`
- [x] 1.2 test(auth): apps/auth: set `globalSetup` / `globalTeardown` in `test/jest-integration.json` and `test/jest-e2e.json` (fallback to the `<rootDir>/node_modules/...` path if Jest rejects the subpath, per design D1) — verify Jest logs container startup before the first suite
- [x] 1.3 test(auth): apps/auth: remove `DATABASE_URL`, `MONGO_URI`, `REDIS_HOST`, `REDIS_PORT` from `.env.test`; in `test/jest.setup.ts` drop their localhost fallbacks and throw when `E2E_CONTAINERS_RUN_ID_ENV` is unset — verify `pnpm --filter auth test:integration` passes with `pnpm docker:down` (no local infra) and `docker ps` shows no leftover `monorepo-e2e-run` containers afterwards
- [x] 1.4 test(auth): apps/auth: make `test/auth.e2e-spec.ts` mount routes like `src/main.ts` (prefix `api`, no health exclusion) and probe `/api/health/live`; remove the stale "mirror production" comment — verify `pnpm --filter auth test:e2e` passes with no local infra
- [x] 1.5 test(auth): verify isolation manually: with `pnpm docker:up`, insert a sentinel row into the local `nestjs` / `nestjs_test` `user` table, run both suites, confirm the row is still there
- [x] 1.6 chore: root: delete `scripts/test-db-setup.mjs` and the `test:db:setup` script from `package.json` — verify `git grep -n "test:db:setup\|test-db-setup"` returns only archived openspec files
- [x] 1.7 docs: update `CONVENTIONS.md`, `ARCHITECTURE_OVERVIEW.md` and `README.md` to say auth integration/E2E suites need Docker and provision containers per run; add a `.claude/CORNER_CASES.md` Testing entry on `setupFiles` `override: true` clobbering `globalSetup` env — verify no doc still mentions `nestjs_test` as a prerequisite
- [x] 1.8 Commit group 1 with `/commit`

## 2. MicroserviceAuthGuard fails fast

- [x] 2.1 feat(shared): packages/shared: add `AUTH_RPC_TIMEOUT_MS = 5000` to `src/constants/` and export it; in `guards/microservice-auth.guard.ts` pipe `timeout(AUTH_RPC_TIMEOUT_MS)` and map `err?.status === 401` → `UnauthorizedException`, anything else → `ServiceUnavailableException` (design D5) — verify `pnpm --filter @repo/shared check-types`
- [x] 2.2 test(shared): packages/shared: extend `guards/microservice-auth.guard.spec.ts` — auth replies `{ status: 401 }` → 401; `send()` never emits (jest fake timers past the bound) → 503; connection `Error` → 503; public route and missing-token cases still send nothing — verify `pnpm --filter @repo/shared test` passes
- [x] 2.3 docs: update `.github/instructions/nestjs-conventions.instructions.md` and `CLAUDE.md` Authentication sections with the 5 s bound and the 401-vs-503 contract — verify both files mention `AUTH_RPC_TIMEOUT_MS`
- [x] 2.4 Commit group 2 with `/commit`

## 3. Probe silencing in all request logs

- [ ] 3.1 refactor(shared): packages/shared: move `isSilentPath` from `utils/sentry.util.ts` to `constants/observability.ts`, strip the query string inside it, and import it back in `sentry.util.ts` — verify existing `sentry.util.spec.ts` still passes unchanged
- [ ] 3.2 fix(shared): packages/shared: use `isSilentPath(req.url ?? '')` in `logging/pino.config.ts` `autoLogging.ignore`, and in `interceptors/logging.interceptor.ts` return `next.handle()` without creating a Mongo log when `isSilentPath(request.url)` — verify `pnpm --filter @repo/shared check-types`
- [ ] 3.3 test(shared): packages/shared: add unit tests for `isSilentPath` (`/api/health/live`, `/health`, `/api/metrics?x=1` silent; `/api/healthcheck`, `/api/users/metrics-report`, `/api/users` not), for the pino `ignore` function, and for `LoggingInterceptor` not calling `mongoService.createLog` on `/api/health/ready` but calling it on `/api/users` — verify `pnpm --filter @repo/shared test` passes
- [ ] 3.4 docs: correct `CONVENTIONS.md` (~line 141), `.github/instructions/nestjs-conventions.instructions.md` (~line 277) and `CLAUDE.md` Logging section so they describe segment matching under any prefix — verify wording matches spec `structured-production-logging`
- [ ] 3.5 Commit group 3 with `/commit`

## 4. update-packages covers every workspace

- [ ] 4.1 chore: root: change `update-packages` to `npx npm-check-updates --workspaces --root -u` — verify `npx npm-check-updates --workspaces --root` (dry run, no `-u`) lists upgrades from `apps/*` / `packages/*` and none for `.ncurc.json`-rejected packages
- [ ] 4.2 docs: update the "Also:" note under the `update-packages` entry in `.claude/CORNER_CASES.md` to say the script now covers workspaces — verify the note no longer tells the reader to run the flag by hand
- [ ] 4.3 Commit group 4 with `/commit`

## 5. Integration verification

- [ ] 5.1 Run `pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test`, and `pnpm --filter auth test:integration && pnpm --filter auth test:e2e` with local infra down — all pass
- [ ] 5.2 Smoke-test the guard: `pnpm docker:up`, start `apps/api` without `apps/auth`, call a protected route with any bearer token — response is 503 in ≤ ~5 s; start `apps/auth`, repeat with an invalid token — 401
- [ ] 5.3 Smoke-test probes: with `apps/api` running, hit `/api/health/live` repeatedly — no pino request line on stdout and no new document in the Mongo `logs` collection; hit a normal route — both appear
- [ ] 5.4 Run `openspec validate harden-tests-guard-and-probes --strict` — passes
