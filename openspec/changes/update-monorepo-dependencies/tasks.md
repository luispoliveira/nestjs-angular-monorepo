> Branch mapping (design.md — D6): groups 1–2 land on `feature/deps-safe-bump`, groups 3–5 on `feature/better-auth-1.7.3`, group 6 on `feature/nestjs-pino-5`. Branch off `develop`, per Gitflow. Groups 1–2 must merge before group 3 starts, so the block list is in place before any further version work.

## 1. chore: guard the dependency-update routine

- [x] 1.1 repo root: create `.ncurc.json` with a `reject` list covering `typescript`, `prisma`/`@prisma/client`, `vitest`, `@nestjs/*` and `ioredis` (rationale moved to `.claude/CORNER_CASES.md` per 1.3/1.4 — `.ncurc.json` is strict JSON passed straight through as CLI options, so inline comments error out with "unknown option"); verified by running `npx npm-check-updates --deep` and confirming none of the five appear as proposed upgrades
- [x] 1.2 repo root: verified the guard holds for the exact hazards found — the dry run proposes no `prisma`/`@prisma/client`, `typescript`, `vitest`, or `@nestjs/*` core package, while still proposing the safe upgrades (`eslint ^10.10.0`, `bullmq ^6.3.4`, etc.); only match for "prisma" in the full output is `@better-auth/prisma-adapter` (not a rejected package)
- [x] 1.3 `.claude/CORNER_CASES.md`: added an entry under "Build / Turborepo / pnpm" recording the deferred upgrades (TypeScript 7, Prisma 8, Vitest 5, NestJS 12, ioredis 6) with each blocker and unblock condition; names all four packages that cap NestJS at 11 (`nestjs-zod`, `@sentry/nestjs`, `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`)
- [x] 1.4 `.claude/CORNER_CASES.md`: added an entry under "Database (Prisma / PrismaPg)" recording the deliberate exception to "never edit an already-applied migration" for this template, per design.md D1; states why the template is exempt (consumed by copy, no upstream remote) and explicitly scopes the exception away from derived projects that have become live systems
- [ ] 1.5 Commit this group using the project `commit` skill (`/commit`)

## 2. chore: apply the safe dependency upgrades

- [x] 2.1 `apps/web`: bumped Angular packages to their current patch versions (`@angular/*` 22.1.6, `@angular/build`/`@angular/cli` 22.1.7, `postcss` 8.5.28, `rxjs` 7.8.2) plus `tslib` 2.8.1 (registry moved slightly since design.md was written — 22.1.6 rather than 22.1.5, same patch-only nature); verified `pnpm --filter web build` (succeeds, pre-existing bundle-budget warning unrelated to this bump) and `pnpm --filter web test` (77/77 tests pass)
- [x] 2.2 all workspaces: bumped the shared lint/test toolchain — `eslint` 10.10.0, `typescript-eslint` 8.70.0, `angular-eslint` 22.5.0 (already applied in 2.1), `globals` 17.12.0, `@eslint/eslintrc` 3.3.7, `jest` 30.5.1; verified `pnpm lint` (12/12 tasks pass, all files clean) and `pnpm test` (16/16 tasks pass — 261 tests total across all apps/packages)
- [x] 2.3 `packages/shared`: bumped `@sentry/nestjs` to 10.74.0, `nestjs-cls` to 6.3.0, `@willsoto/nestjs-prometheus` to 6.1.1; verified `pnpm --filter @repo/shared test` (103/103 pass) and confirmed `@sentry/nestjs` resolved to `^10.74.0` in `package.json`, not the 11 beta
- [x] 2.4 `apps/worker`: bumped `bullmq` to 6.3.4; this split the resolved `bullmq` into two lockfile entries (6.3.4 direct, 6.3.1 via `@nestjs/bullmq`'s peer context) and broke `pnpm build` with a TS2345 structural-typing error on `Queue` — ran `pnpm dedupe` to collapse it back to one resolved version (recorded in `CORNER_CASES.md` under Queues/BullMQ); verified `pnpm --filter worker test` (33/33 pass) and `pnpm build` (12/12 tasks) after the dedupe
- [x] 2.5 repo root: ran the full gate — `pnpm build` (12/12), `pnpm lint` (12/12, all files clean), `pnpm check-types` (12/12), `pnpm test` (16/16 tasks, 261 tests) — all four succeed, no new warnings beyond the two pre-existing ones (the `@babel/core@8.0.1` peer warning and the `apps/web` bundle-budget warning, both unrelated to this change)
- [ ] 2.6 Commit this group using the project `commit` skill (`/commit`)

## 3. chore: raise Zod to ~4.6.0 across the workspace

- [x] 3.1 `pnpm-workspace.yaml`: changed the `overrides.zod` entry from `~4.4.3` to `~4.6.0`; verified the file parses via `pnpm install --lockfile-only` (only the pre-existing `@babel/core` peer warning, unrelated)
- [x] 3.2 all six apps and `packages/shared`, `packages/shared-types`: updated the `zod` dependency from `~4.4.3` to `~4.6.0` in all eight `package.json` files; a repo-wide grep for `~4.4.3` returns no matches
- [x] 3.3 repo root: ran `pnpm install` then `node scripts/verify-single-zod-version.mjs`; exits zero and prints "OK: single resolved zod version — 4.6.0" — confirms the override took effect, not just a single stale resolution
- [x] 3.4 repo root: ran `pnpm build` (12/12), `pnpm check-types` (12/12), `pnpm test` (16/16 tasks, 261 tests) — all pass, Zod v4 API surface (`createZodDto`, `z.email()`, `.meta()`) compiles and validates unchanged. Note: `apps/web`'s production bundle grew ~111 kB (881 kB → 992 kB) — traced to zod's own unpacked package size growing from 4.56 MB (4.4.3) to 6.09 MB (4.6.0), confirmed as a single resolved version (no duplicate-resolution bug like 2.4's bullmq case). This is a real, inherent cost of the new zod version, not a defect in this change; flagged to the user rather than silently absorbed, since bundle size was not a stated acceptance criterion for this change
- [ ] 3.5 Commit this group using the project `commit` skill (`/commit`)

## 4. feat: upgrade better-auth to 1.7.3

- [ ] 4.1 `apps/auth`: bump `better-auth` and `@better-auth/prisma-adapter` to 1.7.3 and `@thallesp/nestjs-better-auth` to 2.8.0; verify `pnpm install` resolves with no unmet peer warning for `zod` (the reason group 3 comes first)
- [ ] 4.2 `apps/web`: bump `better-auth` to 1.7.3 so the client and server stay on one version; verify `pnpm --filter web build` succeeds
- [ ] 4.3 `apps/auth`: verify the existing `betterAuth()` configuration in `app.module.ts` still type-checks against 1.7.3 — the `twoFactor()` and `admin()` plugins and the `advanced.disableOriginCheck` setting are the surfaces to confirm; run `pnpm --filter auth check-types`
- [ ] 4.4 `apps/auth`: run the existing unit and integration suites (`pnpm --filter auth test` and `test:integration`); verify no regression before the schema work begins
- [ ] 4.5 Commit this group using the project `commit` skill (`/commit`)

## 5. feat: model better-auth account identity in the schema

- [ ] 5.1 `packages/database`: run `npx auth generate` against the `apps/auth` configuration to obtain better-auth 1.7's own schema output; verify the output declares `issuer` as required on `account` and a unique compound index on `(issuer, accountId)` before hand-editing anything
- [ ] 5.2 `packages/database/prisma/auth.prisma`: add `issuer String` and `@@unique([issuer, accountId])` to the `Account` model, reconciling against the generated output from 5.1 and retaining `providerId`; verify `pnpm db:generate` succeeds
- [ ] 5.3 `packages/database/prisma/migrations`: regenerate the single `init` migration so a fresh project gets the identity scheme from the start, per design.md D1; verify the emitted SQL contains the `issuer` column as `NOT NULL` and the unique index, and that no second migration directory was created
- [ ] 5.4 `packages/database`: reset the local database and re-apply migrations (`pnpm docker:up`, then `pnpm db:migrate`); verify Prisma reports no drift against `auth.prisma`
- [ ] 5.5 `apps/auth`: write or extend integration tests covering the identity scheme — an account persists with a non-empty issuer, a duplicate `(issuer, accountId)` pair is rejected, and a credential account's issuer marks it local; verify the new tests pass and map to the scenarios in `specs/better-auth-account-identity/spec.md`
- [ ] 5.6 `apps/auth`: run the e2e suite (`pnpm --filter auth test:e2e`); verify sign-up and sign-in both succeed against the new schema
- [ ] 5.7 Commit this group using the project `commit` skill (`/commit`)

## 6. chore: upgrade nestjs-pino to 5.1.0

- [ ] 6.1 all NestJS apps and `packages/shared`: bump `nestjs-pino` from 4.6.1 to 5.1.0; verify `pnpm install` reports no unmet peer for `pino ^10` or `pino-http ^11`, and that Node satisfies the new `>=22.12` engine
- [ ] 6.2 `packages/shared`: verify `LoggerModule` still configures pretty output in dev and JSON in prod, and that `LoggingInterceptor` still persists request/response logs to MongoDB; run `pnpm --filter @repo/shared test`
- [ ] 6.3 `apps/api`: verify correlation-ID threading still works end to end — start the app and confirm a request's `correlationId` appears in the emitted log line and in an `AllExceptionFilter` error response
- [ ] 6.4 Commit this group using the project `commit` skill (`/commit`)

## 7. Final verification

- [ ] 7.1 repo root: run the full gate on the integrated result — `pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`; verify all pass
- [ ] 7.2 repo root: run `pnpm update-packages` one final time and verify it proposes no rejected version, confirming the guard survived every subsequent branch
- [ ] 7.3 repo root: smoke-test the template end to end — bring infra up, migrate, seed, start the apps, and verify sign-up, sign-in, and an email job flowing through the BullMQ queue to the worker all still work
- [ ] 7.4 `openspec/changes/update-monorepo-dependencies`: verify every scenario in both delta specs is covered by a task or test above, and that the backfill procedure in design.md D4 is intact for derived projects
