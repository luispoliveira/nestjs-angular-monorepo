> Branch mapping (design.md — D6): groups 1–2 land on `feature/deps-safe-bump`, groups 3–5 on `feature/better-auth-1.7.3`, group 6 on `feature/nestjs-pino-5`. Branch off `develop`, per Gitflow. Groups 1–2 must merge before group 3 starts, so the block list is in place before any further version work.

## 1. chore: guard the dependency-update routine

- [ ] 1.1 repo root: create `.ncurc.json` with a `reject` list covering `typescript`, `prisma`, `vitest`, `@nestjs/*` and `ioredis`, each entry carrying an inline comment naming its blocker and release condition per design.md D5; verify by running `pnpm update-packages --dry-run` (or `npx npm-check-updates --deep`) and confirming none of the five appear as proposed upgrades
- [ ] 1.2 repo root: verify the guard holds for the exact hazards found — confirm the run does not propose `prisma@8.0.0-rc.13`, `typescript@7.0.2`, or `vitest@5.0.0`, and that it still proposes the safe upgrades (e.g. `eslint@10.10.0`)
- [ ] 1.3 `.claude/CORNER_CASES.md`: add an entry under a build/tooling heading recording the deferred upgrades (TypeScript 7, Prisma 8, Vitest 5, NestJS 12, ioredis 6) with each blocker and unblock condition; verify the entry names the four packages that cap NestJS at 11
- [ ] 1.4 `.claude/CORNER_CASES.md`: add an entry under the database heading recording the deliberate exception to "never edit an already-applied migration" for this template, per design.md D1; verify it states why the template is exempt (consumed by copy, no upstream remote)
- [ ] 1.5 Commit this group using the project `commit` skill (`/commit`)

## 2. chore: apply the safe dependency upgrades

- [ ] 2.1 `apps/web`: bump Angular packages to their current patch versions (`@angular/*` 22.1.5, `@angular/cdk` and `@angular/material` 22.1.6, `@angular/build` and `@angular/cli` 22.1.7) plus `tslib` 2.8.1; verify `pnpm --filter web build` and `pnpm --filter web test` pass
- [ ] 2.2 all workspaces: bump the shared lint/test toolchain — `eslint` 10.10.0, `typescript-eslint` 8.70.0, `angular-eslint` 22.5.0, `globals` 17.12.0, `@eslint/eslintrc` 3.3.7, `jest` 30.5.1; verify `pnpm lint` and `pnpm test` pass across the workspace
- [ ] 2.3 `packages/shared`: bump `@sentry/nestjs` to 10.74.0, `nestjs-cls` to 6.3.0, `@willsoto/nestjs-prometheus` to 6.1.1; verify `pnpm --filter @repo/shared test` passes and that `@sentry/nestjs` stays on the stable 10 line, not the 11 beta
- [ ] 2.4 `apps/worker`: bump `bullmq` to 6.3.4; verify `pnpm --filter worker test` passes
- [ ] 2.5 repo root: run the full gate — `pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test` — and verify all four succeed with no new warnings
- [ ] 2.6 Commit this group using the project `commit` skill (`/commit`)

## 3. chore: raise Zod to ~4.6.0 across the workspace

- [ ] 3.1 `pnpm-workspace.yaml`: change the `overrides.zod` entry from `~4.4.3` to `~4.6.0`; verify the file parses by running `pnpm install --lockfile-only`
- [ ] 3.2 all six apps and `packages/shared`, `packages/shared-types`: update the `zod` dependency from `~4.4.3` to `~4.6.0` in all eight `package.json` files; verify with a repo-wide grep that no `~4.4.3` reference to zod remains
- [ ] 3.3 repo root: run `pnpm install` then `node scripts/verify-single-zod-version.mjs`; verify it exits zero **and** that the version it prints is on the 4.6 line — an exit code alone does not prove the override took effect
- [ ] 3.4 repo root: run `pnpm build`, `pnpm check-types` and `pnpm test`; verify the Zod v4 API surface used across `packages/shared-types` and the NestJS DTOs still compiles and validates unchanged
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
