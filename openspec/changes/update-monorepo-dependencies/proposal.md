## Why

The monorepo's dependencies have drifted behind the registry, and the routine used to catch up — `pnpm update-packages`, a bare `npm-check-updates -u` with no rejection list — is actively unsafe: it silently upgrades the Prisma CLI to `8.0.0-rc.13` (the `latest` dist-tag currently points at a release candidate), TypeScript to `7.0.2` (which no peer in this stack accepts), and Vitest to `5.0.0` (which `@angular/build` rejects). Because this repo is a GitHub template repository, that trap is copied into every project derived from it.

Separately, `apps/auth` already runs better-auth `1.7.2`, but `packages/database/prisma/auth.prisma` still models the `account` table in its pre-1.7 shape — it is missing the `issuer` field and the compound uniqueness that better-auth 1.7 uses to identify accounts. The installed library and the schema are out of step today, independently of this upgrade.

## What Changes

- Apply the safe upgrade set across all workspaces: Angular 22.1.x patches, ESLint 10.10, typescript-eslint 8.70, angular-eslint 22.5, `@sentry/nestjs` 10.74, `nestjs-cls` 6.3, Jest 30.5.1, BullMQ 6.3.4, and related patch bumps.
- Raise Zod from `~4.4.3` to `~4.6.0` across all eight `package.json` files and the `pnpm-workspace.yaml` override. This is **required**, not cosmetic: better-auth 1.7.3 depends on `zod ^4.5.4`, which the current `~4.4.3` override cannot satisfy.
- Upgrade better-auth `1.7.2 → 1.7.3`, `@better-auth/prisma-adapter`, and `@thallesp/nestjs-better-auth` `2.7.0 → 2.8.0` in `apps/auth` and `apps/web`.
- **BREAKING (for derived projects):** add `issuer` to the `Account` model in `packages/database/prisma/auth.prisma` with a unique compound index on `(issuer, accountId)`, and regenerate the single `init` migration rather than adding an incremental one. Existing derived projects must backfill their own `account` rows; the template provides the procedure.
- Upgrade `nestjs-pino` `4.6.1 → 5.1.0` as an isolated major.
- Introduce a rejection list for the dependency-update tooling that blocks the upgrades this stack cannot currently accept, each recorded with its concrete blocker and its unblock condition.
- Record the deferred upgrades and the deliberate migration-regeneration exception in `.claude/CORNER_CASES.md`.

## Capabilities

### New Capabilities

- `dependency-upgrade-policy`: The workspace's dependency-update routine must refuse to adopt versions that are not production-ready or that no peer in the stack accepts, and must state why each is blocked and when it can be reconsidered. Covers the guard itself, not any individual version choice.
- `better-auth-account-identity`: The persisted account model must match the identity scheme better-auth uses to look up accounts — an issuer alongside the provider account identifier, unique in combination — and derived projects must have a defined path to migrate existing account rows onto it.

### Modified Capabilities

None. `zod-shared-contract` requires exactly one resolved schema-library version and says nothing about which version, so moving `4.4.3 → 4.6.0` satisfies it unchanged.

## Non-goals

- **NestJS 12.** Available, but `nestjs-zod@5.5.0`, `@sentry/nestjs@10.74.0`, `@nestjs/throttler@6.5.0`, and `@nest-lab/throttler-storage-redis@1.2.0` all cap their peer range at NestJS 11. Adopting 12 would require overrides that suppress genuine incompatibilities across `packages/shared`.
- **TypeScript 7.** Blocked by `@angular/compiler-cli`, `@angular/build`, `typescript-eslint`, `ts-jest`, and `@thallesp/nestjs-better-auth`.
- **Prisma 8.** Only exists as a release candidate; `@prisma/client` has no stable 8 at all.
- **Vitest 5.** `@angular/build@22.1.7` pins `vitest ^4.0.8`.
- **ioredis 6.** No formal peer conflict, but BullMQ carries its own ioredis and a major-version split warrants its own investigation.
- Writing a migration guide document for derived projects. The backfill procedure is captured in `design.md`; publishing it as user-facing documentation is a separate decision.
- Any application code change beyond what the version bumps themselves require.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Regenerating the `init` migration contradicts the project rule "never edit migrations already applied" | The rule targets live systems; a template is a seed. Because the template is consumed by copy (GitHub template repository), no derived project receives migrations over git, so an incremental migration would reach nobody. Record the exception in `CORNER_CASES.md` so it is not reverted later by someone applying the rule literally. |
| Derived projects with real `account` data break on the new uniqueness constraint | The template repo itself has no seeded accounts, so the risk is entirely downstream. Capture a verified backfill procedure — including the duplicate-key pre-check — in `design.md`. |
| Developers with an existing local database hit Prisma migration drift | Local databases are disposable in this template (`pnpm docker:up`); a reset is acceptable and noted in the tasks. |
| The Zod bump ripples across `packages/shared-types`, `packages/shared`, and all six apps | `scripts/verify-single-zod-version.mjs` already fails the build on a split resolution; run it as an explicit verification step. |
| The rejection list silently freezes dependencies indefinitely | Each entry records its blocker and its unblock condition, so the list is reviewable rather than opaque. |

## Alternatives considered

- **Incremental `add_account_issuer` migration instead of regenerating `init`.** Rejected: the template is consumed by copy, so derived projects have no upstream remote and would never receive the migration. It would serve no consumer while leaving new projects with a two-step history for a schema that could simply be correct from the start.
- **Adopt NestJS 12 with `pnpm.overrides` to bypass the peer ranges.** Rejected: the caps reflect real untested combinations across the validation and error-reporting layers, not stale metadata.
- **One large upgrade branch.** Rejected in favour of three: the safe bumps, the better-auth and schema work, and the `nestjs-pino` major. The schema migration is the risky part and deserves review in isolation.
- **Pin exact versions everywhere instead of a rejection list.** Rejected: it would freeze patch-level security fixes too, and it does not communicate *why* a version is being avoided.

## Impact

- **Affected packages:** all eight `package.json` files plus `pnpm-workspace.yaml` (Zod override), `packages/database` (`prisma/auth.prisma`, `prisma/migrations/`), `apps/auth` and `apps/web` (better-auth), `packages/shared` (Sentry, cls, pino).
- **Tooling:** the `update-packages` script gains a rejection list; `scripts/verify-single-zod-version.mjs` becomes a gating check for the Zod bump.
- **Database:** the `account` table gains a required `issuer` column and a unique `(issuer, accountId)` index. For credential accounts the `accountId` value itself is rewritten, so this is a data migration, not only a column addition.
- **Derived projects:** must perform their own backfill before adopting the new schema; the template cannot do it for them.
- **Documentation:** `.claude/CORNER_CASES.md` gains entries for the deferred upgrades and the migration-regeneration exception.
