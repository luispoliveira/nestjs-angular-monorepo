## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Distribution model.** This repo is a GitHub *template repository*. Derived projects are copies with no upstream remote, so nothing produced here reaches them over git. Anything a derived project must *do* has to be expressed as a procedure, not as a file they will receive.
- **Peer-range reality.** Four of the headline upgrades are blocked by peer requirements already present in the workspace, not by taste:

  | Upgrade | Declared by | Requirement | Verdict |
  | --- | --- | --- | --- |
  | TypeScript 7.0.2 | `@angular/compiler-cli@22.1.5`, `@angular/build@22.1.7` | `typescript >=6.0 <6.1` | excluded |
  | | `typescript-eslint@8.70.0` | `typescript >=4.8.4 <6.1.0` | excluded |
  | | `ts-jest@29.4.12` | `typescript >=4.3 <7` | excluded |
  | | `@thallesp/nestjs-better-auth@2.8.0` | `typescript ^5.9.2 \|\| ^6.0.0` | excluded |
  | Vitest 5.0.0 | `@angular/build@22.1.7` | `vitest ^4.0.8` | excluded |
  | NestJS 12.0.1 | `nestjs-zod@5.5.0` | `@nestjs/common ^10 \|\| ^11`, `@nestjs/swagger ^7.4.2 \|\| ^8 \|\| ^11` | excluded |
  | | `@sentry/nestjs@10.74.0` | `@nestjs/core ^8..^11` | excluded |
  | | `@nestjs/throttler@6.5.0` | `@nestjs/core ^7..^11` | excluded |
  | | `@nest-lab/throttler-storage-redis@1.2.0` | `@nestjs/core ^7..^11` | excluded |

- **Prisma's dist-tags.** `prisma` publishes `latest = 8.0.0-rc.13` while `@prisma/client` publishes `latest = 7.10.0`. This is not a peer conflict — it is a channel hazard. A bare `ncu -u` splits the CLI from the client across a major version.
- **Zod is force-pinned.** `pnpm-workspace.yaml` carries `overrides: zod: '~4.4.3'`, which resolves to `>=4.4.3 <4.5.0`. better-auth `1.7.3` depends on `zod ^4.5.4`. The override currently *contradicts* the library it is meant to support.
- **Schema drift already exists.** `apps/auth` runs better-auth 1.7.2 while `packages/database/prisma/auth.prisma` models `account` without `issuer`. The change corrects a present inconsistency, it does not introduce one.
- **`apps/auth` uses only `twoFactor()` and `admin()`** plus optional Google social. Of better-auth 1.7's schema changes (protected resources, SCIM, DPoP, device authorization, `oauthClient`, organization team counters), **only account identity applies**. No SCIM reprovisioning, no OAuth client data move, no maintenance window.

## Goals / Non-Goals

**Goals:**

- Make `pnpm update-packages` safe to run unattended, in this repo and in every project copied from it.
- Bring `auth.prisma` back into agreement with the better-auth version already installed.
- Give derived projects a correct, verified backfill procedure they can execute against their own data.
- Keep the risky work (schema) reviewable separately from the routine work (version bumps).

**Non-Goals:**

- Choosing the *content* of the block list as a permanent policy. The list is a snapshot with stated release conditions; it is expected to shrink.
- Automating the derived-project backfill. The template cannot see downstream data; it supplies the procedure and the pre-check.
- Publishing user-facing upgrade documentation. Deferred (see `proposal.md` — Non-goals).

## Decisions

### D1 — Regenerate the `init` migration instead of adding an incremental one

**Involves:** `packages/database/prisma/migrations/`, `packages/database/prisma/auth.prisma`.

The repo has exactly one migration, `20260313155633_init` (103 lines). It will be regenerated to include `issuer` and the compound unique index, rather than adding an `add_account_issuer` migration on top.

*Why:* the template is consumed by copy. A derived project has no upstream remote, so an incremental migration would be delivered to nobody, while leaving every *new* project with a two-step history for a schema that could be correct from the start. The migration file is not the delivery vehicle for downstream projects — the procedure in D4 is.

*Alternative considered:* incremental migration, preserving history. Rejected — it optimises for a consumer that does not exist under this distribution model.

*This deliberately contradicts the project rule "new migration, never edit an already-applied migration."* That rule governs live systems; a template is a seed. The exception is recorded in `.claude/CORNER_CASES.md` (D6) specifically so a later maintainer applying the rule literally does not revert it.

### D2 — Data model change: `Account.issuer`

**Involves:** `packages/database/prisma/auth.prisma`.

```prisma
model Account {
  id                    String    @id
  issuer                String                 // added — required
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  // ... unchanged fields ...

  @@unique([issuer, accountId])                // added
  @@index([userId])
  @@map("account")
}
```

`providerId` is retained — better-auth 1.7 keeps it alongside the new identity pair; `issuer` does not replace it.

Note that `auth.prisma` is normally owned by better-auth and not hand-edited. The field set here is not invented: it is what better-auth 1.7's own table definition declares (`issuer` required, unique compound index on `issuer` + `accountId`). Generating it with better-auth's own CLI (`npx auth generate`) and reconciling the output with the existing file is preferred over hand-writing the block.

*Auth/authorization impact:* none at the role or guard level. `RoleEnum`, `AuthGuard`, `MicroserviceAuthGuard`, and the `admin()`/`twoFactor()` plugin surfaces are unaffected. The change is confined to how an account row is keyed. No new REST endpoint, event pattern, message pattern, or queue job.

### D3 — Zod to `~4.6.0`, treated as a prerequisite of the better-auth bump

**Involves:** all six apps, `packages/shared`, `packages/shared-types`, `pnpm-workspace.yaml`, `scripts/verify-single-zod-version.mjs`.

The bump touches eight `package.json` files **and** the workspace override. Missing the override leaves the tree resolving 4.4.3 against a library requiring `^4.5.4`.

`scripts/verify-single-zod-version.mjs` already fails when the lockfile resolves more than one `zod`; it is the verification step for this decision, not an afterthought. It parses the lockfile textually and reports the resolved version — run it and confirm the version it prints is the new one, not merely that it exits zero.

*Why grouped with better-auth rather than with the safe bumps:* it is a hard dependency of better-auth 1.7.3. Splitting them would produce an intermediate commit whose dependency graph is unsatisfiable.

### D4 — The backfill is a procedure, not a migration

**Involves:** derived projects; captured here and referenced from `tasks.md`.

The template repo has no seeded accounts, so it executes nothing. What it owes downstream is a correct procedure. Per better-auth's 1.7 upgrade guide:

**Step 0 — pre-check for collisions (must run before anything else):**

```sql
SELECT "providerId", "accountId", count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;
```

Any rows returned must be resolved first. better-auth rejects an account lookup that matches more than one row.

**Step 1 — add `issuer` as nullable.** Keep the existing `accountId` column.

**Step 2 — populate both fields by account type:**

| Account type | `issuer` | `accountId` |
| --- | --- | --- |
| Credential (password) | `local:credential` | the linked `user` row's `id` |
| Provider with an issuer | the provider's exact trusted issuer | unchanged |
| OAuth provider without an issuer | `local:oauth:<encoded providerId>` | unchanged |

**Step 3 — verify, then constrain.** Confirm every row has both fields, make `issuer` `NOT NULL`, add the unique index on `(issuer, accountId)`.

The credential row rewrite is the step most easily missed: `accountId` becomes the user's `id`, so this is a data migration, not a column addition. Any derived project that has enabled Google social must use Google's issuer for those rows.

*Alternative considered:* ship the backfill as a runnable SQL script in the template. Rejected — it cannot be correct without knowing which providers a given project enabled, and a script that looks authoritative but is wrong for the reader's data is worse than a procedure they must read.

### D5 — Block list as tool configuration, not version pins

**Involves:** repo root, alongside the `update-packages` script.

`npm-check-updates` reads a rejection list from an `.ncurc.json` at the repo root. Each entry carries its cause and its release condition:

| Rejected | Cause | Release condition |
| --- | --- | --- |
| `typescript` | Angular 22, typescript-eslint, ts-jest all cap below 6.1 / 7 | Angular publishes a release accepting TS 7 |
| `prisma` | `latest` dist-tag serves `8.0.0-rc.13`; client has no stable 8 | `@prisma/client` publishes a stable 8 |
| `vitest` | `@angular/build@22.1.7` pins `vitest ^4.0.8` | `@angular/build` widens its peer range |
| `@nestjs/*` | `nestjs-zod`, `@sentry/nestjs`, `@nestjs/throttler`, `@nest-lab/throttler-storage-redis` all cap at 11 | all four publish NestJS 12 support |
| `ioredis` | major split against BullMQ's bundled ioredis; unassessed | separate investigation |

*Why a config file over exact pins:* pins freeze patch-level security fixes and carry no explanation. A rejection list blocks only the specific upgrade and states why, and — because `.ncurc.json` sits at the repo root — it is copied into every derived project along with the script it protects, satisfying the template-reach requirement in the `dependency-upgrade-policy` spec.

*Why not `pnpm.overrides`:* overrides suppress the peer warnings that are the actual signal here. The goal is to *respect* the constraints, not silence them.

### D6 — Three branches, not one

**Involves:** all affected packages.

```
  feature/deps-safe-bump        low risk, no behavior change
        |                       (safe versions + .ncurc.json)
        v
  feature/better-auth-1.7.3     zod + better-auth + schema + migration
        |                       (the reviewable core)
        v
  feature/nestjs-pino-5         isolated major, trivially revertible
```

Sequential rather than parallel: the safe bump lands the block list first, so the later branches cannot reintroduce a rejected version. `nestjs-pino` 5 requires `pino ^10` and Node `>=22.12` — the repo is on Node 24.19, so the engine is satisfied.

`.claude/CORNER_CASES.md` gains two entries, both in the first branch: the deferred upgrades (under a build/tooling heading) and the migration-regeneration exception (under the database heading).

## Risks / Trade-offs

- **Regenerated `init` breaks local developer databases** → Prisma reports drift and requires a reset. Acceptable: local DBs are disposable here (`pnpm docker:up`). Called out explicitly in `tasks.md` rather than left to be discovered.
- **A derived project applies the new schema without the backfill** → the `NOT NULL` on `issuer` fails, or the unique index rejects the data. This is a loud failure, not a silent one, which is the preferable failure mode. The pre-check in D4 catches it earlier.
- **The credential `accountId` rewrite is skipped** → accounts survive the migration but stop resolving at sign-in. This is the sharpest edge in the whole change; it is called out in both D4 and the spec's scenarios.
- **The Zod override is updated but an app manifest is missed** → two resolved versions, `instanceof` identity breaks silently across packages. Mitigated by `verify-single-zod-version.mjs` as a gating step, checking the printed version and not just the exit code.
- **`.ncurc.json` blocks an upgrade long after its cause is gone** → each entry states its release condition, so the list is auditable. Accepted trade-off: it still requires someone to look.
- **Deferring NestJS 12 accumulates upgrade debt** → the four blockers are likely to clear at similar times, since they are all tracking the same major. When they do, the upgrade becomes a single coordinated change rather than four.
- **`@sentry/nestjs` 11 is in beta** → not adopted; the safe bump takes 10.74.0, the newest stable.

## Migration Plan

1. **`feature/deps-safe-bump`** — safe versions, `.ncurc.json`, `CORNER_CASES.md` entries. Verify `pnpm update-packages` no longer proposes a rejected version. Full build, lint, type-check, tests.
2. **`feature/better-auth-1.7.3`** — Zod across nine locations, then better-auth packages, then `auth.prisma`, then regenerate the migration. Reset the local database, migrate, and exercise sign-up and sign-in end to end.
3. **`feature/nestjs-pino-5`** — the major alone. Confirm log output and correlation-ID threading still behave.

**Rollback:** each branch reverts independently. Branch 2 additionally requires a local database reset on revert, since the regenerated migration will no longer match. No production system is involved — the repo holds no account data.

## Open Questions

- Whether to publish the D4 backfill procedure as a user-facing document for derived projects (`docs/`), or leave it in `design.md`. Deferrable: it changes no spec, no approach, and no task in this change.
