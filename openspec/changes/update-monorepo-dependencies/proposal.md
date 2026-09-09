## Why

The monorepo's dependencies have drifted behind the registry, and the routine used to catch up — `pnpm update-packages`, a bare `npm-check-updates -u` with no rejection list — is actively unsafe: it silently upgrades the Prisma CLI to `8.0.0-rc.13` (the `latest` dist-tag currently points at a release candidate), TypeScript to `7.0.2` (which no peer in this stack accepts), and Vitest to `5.0.0` (which `@angular/build` rejects). Because this repo is a GitHub template repository, that trap is copied into every project derived from it.

Separately, at proposal time `apps/auth` ran better-auth `1.7.2`, which required an `issuer` field on the `account` table that `packages/database/prisma/auth.prisma` did not have. That specific mismatch turned out to be moot by the time of implementation — see "Investigated and not carried forward" below — but the underlying question (does the schema match what the installed better-auth version actually requires?) was worth settling before shipping the version bump, and the investigation is captured here for anyone who re-derives the same concern from the same starting evidence.

## What Changes

- Apply the safe upgrade set across all workspaces: Angular 22.1.x patches, ESLint 10.10, typescript-eslint 8.70, angular-eslint 22.5, `@sentry/nestjs` 10.74, `nestjs-cls` 6.3, Jest 30.5.1, BullMQ 6.3.4, and related patch bumps.
- Raise Zod from `~4.4.3` to `~4.6.0` across all eight `package.json` files and the `pnpm-workspace.yaml` override. This is **required**, not cosmetic: better-auth 1.7.3 depends on `zod ^4.5.4`, which the current `~4.4.3` override cannot satisfy.
- Upgrade better-auth `1.7.2 → 1.7.3`, `@better-auth/prisma-adapter`, and `@thallesp/nestjs-better-auth` `2.7.0 → 2.8.0` in `apps/auth` and `apps/web`.
- **BREAKING (for derived projects with existing data, though additive):** add three columns to the `TwoFactor` model in `packages/database/prisma/auth.prisma` (`verified`, `failedVerificationCount`, `lockedUntil`) and regenerate the `init` migration. Required, not optional — see "Applied: TwoFactor schema fix" below.
- Upgrade `nestjs-pino` `4.6.1 → 5.1.0` as an isolated major.
- Introduce a rejection list for the dependency-update tooling that blocks the upgrades this stack cannot currently accept, each recorded with its concrete blocker and its unblock condition.
- Record the deferred upgrades in `.claude/CORNER_CASES.md`.
- Fix a pre-existing, unrelated defect surfaced while verifying the better-auth bump: `apps/auth`'s `test:integration` failed to load at all under Jest's plain CommonJS mode, because `@faker-js/faker` (a `packages/testing-utils` dependency) ships pure ESM with no CommonJS build. Not caused by this change and not gated behind it, but fixed alongside it since verifying the better-auth bump required a working integration suite.

### Investigated and not carried forward: `Account.issuer` schema change

The original exploration (before implementation began) found that better-auth 1.7.0–1.7.2 required an `issuer` column on `account` with a unique `(issuer, accountId)` index, which `auth.prisma` did not have, and planned a schema migration plus a derived-project backfill procedure to close that gap.

During implementation, verifying the better-auth 1.7.3 upgrade surfaced that **better-auth's own team reverted this requirement before 1.7.3 shipped**, specifically because of the backfill cost the original exploration was already worried about. Three independent sources confirm this, checked against the exact versions installed in this workspace:

1. **Source diff** — `@better-auth/core@1.7.2`'s `src/db/get-tables.ts` declares `issuer` as a required `account` field with a unique compound index; the same file in the installed `@better-auth/core@1.7.3` has neither.
2. **better-auth's own tooling** — 1.7.3's `schema-diff.ts` (its schema-drift diagnostic) contains a hint text for exactly this column: *"If this column came from Better Auth 1.7.0 through 1.7.2, follow the upgrade guide before **removing** it"* — the tool now exists to help people undo the 1.7.0–1.7.2 change, not apply it.
3. **Official release notes** (`gh release view v1.7.3 --repo better-auth/better-auth`) — *"We restored the 1.6 account core schema to avoid requiring a disruptive backfill for existing users... If you applied the 1.7 issuer schema, follow the upgrade guide for the required cleanup. No backfill is needed."* — and the linked PR: *"Restored compatibility with 1.6 account schemas by identifying accounts with `(providerId, accountId)` instead of issuer."*

This was additionally verified empirically: a throwaway script called better-auth 1.7.3's real `signUpEmail` API (not a test-factory bypass) against the actual `auth.prisma` schema (no `issuer` column) on the local Postgres test database, and it succeeded, producing an `account` row with no `issuer` field, matching the source-code finding exactly.

**Conclusion:** `auth.prisma`'s current `Account` model (no `issuer`) already matches what better-auth 1.7.3 requires. No schema change, no migration regeneration, and no derived-project backfill procedure are needed for this upgrade. The `better-auth-account-identity` capability and its spec, originally proposed here, are withdrawn — see the capabilities section below.

### Applied: `TwoFactor` schema fix

Verifying the better-auth 1.7.3 upgrade with a real end-to-end sign-up/sign-in flow (not the test-factory bypass used elsewhere in this workspace's tests) surfaced a second, genuinely necessary schema gap — unrelated to the withdrawn `Account.issuer` investigation above, and with the opposite conclusion.

better-auth 1.7.3 added a new default-on behavior (per its release notes: *"Enabled schema validation during initialization by default, including in production, and rejected authentication requests on detected mismatches"*), which now checks every registered plugin's expected fields against the Prisma client's schema at startup. With the `twoFactor()` plugin registered (as `apps/auth` does), this reported `auth.prisma`'s `TwoFactor` model missing three columns: `verified`, `failedVerificationCount`, `lockedUntil`.

Diffing `@better-auth/core`'s `two-factor/schema.ts` between the installed 1.7.2 and 1.7.3 packages shows these three fields **unchanged** between versions — this is not a new requirement, unlike the reverted `issuer` case. `auth.prisma` had simply never carried them; better-auth 1.7.2 silently tolerated the gap (the fields are all `required: false` on better-auth's side), and 1.7.3's new validation now surfaces it as a hard failure that rejects auth requests.

All three columns are optional/defaulted on better-auth's side (`verified: Boolean? @default(true)`, `failedVerificationCount: Int? @default(0)`, `lockedUntil: DateTime?`), so the fix is purely additive — no uniqueness constraint, no `NOT NULL`, no data rewrite, safe to apply even against an existing project's `twoFactor` data. Applied by adding the columns to `auth.prisma` and regenerating the `init` migration (per the same D1 reasoning that did not end up applying to the `issuer` case — see `design.md`). Verified with a full local database reset and a real `sign-up`/`sign-in` round trip through `apps/auth`'s e2e suite (previously blocked by an unrelated local Docker issue, resolved independently during this session): 8/8 tests pass.

## Capabilities

### New Capabilities

- `dependency-upgrade-policy`: The workspace's dependency-update routine must refuse to adopt versions that are not production-ready or that no peer in the stack accepts, and must state why each is blocked and when it can be reconsidered. Covers the guard itself, not any individual version choice.
- `better-auth-two-factor-schema`: The persisted `TwoFactor` model must carry every field the registered `twoFactor()` plugin expects, so that better-auth's own schema validation succeeds and two-factor authentication requests are not rejected.

### Modified Capabilities

None. `zod-shared-contract` requires exactly one resolved schema-library version and says nothing about which version, so moving `4.4.3 → 4.6.0` satisfies it unchanged.

## Non-goals

- **NestJS 12.** Available, but `nestjs-zod@5.5.0`, `@sentry/nestjs@10.74.0`, `@nestjs/throttler@6.5.0`, and `@nest-lab/throttler-storage-redis@1.2.0` all cap their peer range at NestJS 11. Adopting 12 would require overrides that suppress genuine incompatibilities across `packages/shared`.
- **TypeScript 7.** Blocked by `@angular/compiler-cli`, `@angular/build`, `typescript-eslint`, `ts-jest`, and `@thallesp/nestjs-better-auth`.
- **Prisma 8.** Only exists as a release candidate; `@prisma/client` has no stable 8 at all.
- **Vitest 5.** `@angular/build@22.1.7` pins `vitest ^4.0.8`.
- **ioredis 6.** No formal peer conflict, but BullMQ carries its own ioredis and a major-version split warrants its own investigation.
- **`Account.issuer` schema change.** Investigated and found unnecessary for better-auth 1.7.3 — see "Investigated and not carried forward" above.
- Any application code change beyond what the version bumps themselves require, the one pre-existing test-infrastructure fix, and the one genuinely-required `TwoFactor` schema fix, both noted above.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The Zod bump ripples across `packages/shared-types`, `packages/shared`, and all six apps | `scripts/verify-single-zod-version.mjs` already fails the build on a split resolution; run it as an explicit verification step, checking the printed version, not just the exit code. |
| The rejection list silently freezes dependencies indefinitely | Each entry records its blocker and its unblock condition, so the list is reviewable rather than opaque. |
| Bumping a single package (e.g. `bullmq`) can leave two resolved versions in the lockfile until `pnpm dedupe` runs, breaking the build with a structural-typing error | Documented in `CORNER_CASES.md`; run `pnpm dedupe` after any single-package bump that other workspaces also depend on. |
| The withdrawn `Account.issuer` investigation could be silently forgotten and re-litigated by a future maintainer working from stale documentation | Captured in this proposal with the exact evidence chain (source diff, better-auth's own tooling hint, official release notes) so the question does not need to be re-investigated from scratch. |
| Editing `auth.prisma` and running `pnpm db:generate` is not sufficient — `packages/database`'s own compiled output (`dist/generated/prisma/`) is a separate build artifact that only `pnpm build` refreshes, and a stale copy reproduces the exact same "missing columns" error even after the schema and the live database are both already correct | Documented in `CORNER_CASES.md`; always run `pnpm build` for `packages/database` immediately after `pnpm db:generate` when `auth.prisma` changes. |
| A derived project with existing `twoFactor` rows applies this fix | Safe: all three columns are nullable with database-level defaults, so `ALTER TABLE ADD COLUMN` carries no data risk regardless of existing row count. |

## Alternatives considered

- **Adopt NestJS 12 with `pnpm.overrides` to bypass the peer ranges.** Rejected: the caps reflect real untested combinations across the validation and error-reporting layers, not stale metadata.
- **One large upgrade branch.** Rejected in favour of three: the safe bumps, the better-auth work, and the `nestjs-pino` major.
- **Pin exact versions everywhere instead of a rejection list.** Rejected: it would freeze patch-level security fixes too, and it does not communicate *why* a version is being avoided.
- **Proceed with the `Account.issuer` migration anyway, as forward-compatibility groundwork.** Rejected: better-auth's own team walked this back specifically to spare users a disruptive backfill; re-adding it here would reintroduce the exact cost better-auth removed, for a feature the installed version does not use.

## Impact

- **Affected packages:** all eight `package.json` files plus `pnpm-workspace.yaml` (Zod override), `apps/auth` and `apps/web` (better-auth), `packages/shared` (Sentry, cls, pino), `apps/auth/test` (Jest ESM fix for the pre-existing `test:integration` defect), `packages/database` (`auth.prisma`, the regenerated `init` migration).
- **Tooling:** the `update-packages` script gains a rejection list; `scripts/verify-single-zod-version.mjs` becomes a gating check for the Zod bump.
- **Database:** the `TwoFactor` table gains three nullable, defaulted columns (`verified`, `failedVerificationCount`, `lockedUntil`). Purely additive — no constraint, no data rewrite. The `Account` model is unchanged (see the withdrawn investigation above).
- **Documentation:** `.claude/CORNER_CASES.md` gains entries for the deferred upgrades, the `bullmq`/`pnpm dedupe` gotcha, the `test:integration` ESM fix, better-auth 1.7.3's new default-on schema validation, and the `pnpm db:generate`-then-`pnpm build` requirement.
