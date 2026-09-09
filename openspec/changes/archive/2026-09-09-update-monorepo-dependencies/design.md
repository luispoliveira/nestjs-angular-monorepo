## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Distribution model.** This repo is a GitHub *template repository*. Derived projects are copies with no upstream remote, so nothing produced here reaches them over git. Anything a derived project must *do* has to be expressed as a procedure, not as a file they will receive. (This mattered directly for D1 below, before that decision was withdrawn — kept in mind for any future template-wide schema correction.)
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
- **The `account` schema question was investigated and closed.** The original exploration found better-auth 1.7.0–1.7.2 required an `Account.issuer` column that `auth.prisma` lacked. Verifying the 1.7.3 upgrade during implementation found that better-auth's own team reverted this requirement before 1.7.3 shipped — confirmed by source diff, by 1.7.3's own schema-diagnostic tool, by the official release notes, and empirically against the real `signUpEmail` API on the local test database. Full evidence chain in `proposal.md` — "Investigated and not carried forward." `auth.prisma` needs no change. Decisions D1, D2, and D4 below are retained in their original, superseded form for anyone tracing the same investigation from the same starting point — each is marked withdrawn at its own heading.
- **`apps/auth` uses only `twoFactor()` and `admin()`** plus optional Google social. Of better-auth 1.7's schema changes generally (protected resources, SCIM, DPoP, device authorization, `oauthClient`, organization team counters), none apply to this app's plugin surface — except that `twoFactor()` itself required a schema correction, found only by exercising a real sign-up/sign-in flow. See D7.
- **better-auth 1.7.3 validates its schema at startup by default and rejects auth requests on any mismatch** (new behavior, per its release notes). This is what actually surfaced the `TwoFactor` gap in D7 below — 1.7.2 silently tolerated the same gap. A version bump that adds default-on runtime validation can turn a previously-silent, previously-harmless gap into a hard failure without changing what fields a plugin declares; verifying "does the schema still work" needs an actual request through the real API, not just a type-check or a test-factory bypass that writes to Prisma directly.

## Goals / Non-Goals

**Goals:**

- Make `pnpm update-packages` safe to run unattended, in this repo and in every project copied from it.
- Upgrade better-auth to the version this workspace should run, verifying compatibility with the installed schema rather than assuming a doc written for the 1.7 series still describes the 1.7.3 release.
- Keep the reviewable core (better-auth + Zod) separate from the routine work (safe version bumps) and the isolated major (`nestjs-pino`).

**Non-Goals:**

- Choosing the *content* of the block list as a permanent policy. The list is a snapshot with stated release conditions; it is expected to shrink.
- Publishing user-facing upgrade documentation. Deferred (see `proposal.md` — Non-goals).
- Any `Account` model change. Investigated and found unnecessary — see Context above. (The `TwoFactor` model does change — see D7 — for an unrelated, genuinely necessary reason.)

## Decisions

### D1 — WITHDRAWN: Regenerate the `init` migration instead of adding an incremental one

**Status:** withdrawn. Retained here, unedited from the original proposal, because the reasoning is still valid *if* a genuine template-wide schema correction is ever needed — only its premise (that this change requires one) turned out to be false.

> The repo has exactly one migration, `20260313155633_init` (103 lines). It would be regenerated to include a schema correction, rather than adding an incremental migration on top.
>
> *Why:* the template is consumed by copy. A derived project has no upstream remote, so an incremental migration would be delivered to nobody, while leaving every *new* project with a two-step history for a schema that could be correct from the start.
>
> *This would deliberately contradict the project rule "new migration, never edit an already-applied migration."* That rule governs live systems; a template is a seed. Such an exception belongs in `.claude/CORNER_CASES.md` specifically so a later maintainer applying the rule literally does not revert it — not applied in this change, since no migration was regenerated.

No `auth.prisma` or migration file was touched in this change.

### D2 — WITHDRAWN: Data model change: `Account.issuer`

**Status:** withdrawn. The `issuer` field and its unique compound index were specific to better-auth 1.7.0–1.7.2 and were removed by better-auth before 1.7.3 — see Context above and `proposal.md`. `auth.prisma`'s `Account` model is unchanged by this decision, in this change.

### D3 — Zod to `~4.6.0`, treated as a prerequisite of the better-auth bump

**Involves:** all six apps, `packages/shared`, `packages/shared-types`, `pnpm-workspace.yaml`, `scripts/verify-single-zod-version.mjs`.

The bump touches eight `package.json` files **and** the workspace override. Missing the override leaves the tree resolving 4.4.3 against a library requiring `^4.5.4`.

`scripts/verify-single-zod-version.mjs` already fails when the lockfile resolves more than one `zod`; it is the verification step for this decision, not an afterthought. It parses the lockfile textually and reports the resolved version — run it and confirm the version it prints is the new one, not merely that it exits zero.

*Why grouped with better-auth rather than with the safe bumps:* it is a hard dependency of better-auth 1.7.3. Splitting them would produce an intermediate commit whose dependency graph is unsatisfiable.

*Observed side effect:* `apps/web`'s production bundle grew ~111 kB after this bump — traced to zod's own unpacked package size growing between 4.4.3 and 4.6.0, confirmed as a single resolved copy (not a duplicate-resolution bug). Not a defect in this change; flagged since bundle size was not a stated acceptance criterion.

### D4 — WITHDRAWN: The backfill is a procedure, not a migration

**Status:** withdrawn along with D2. Retained here, unedited, for anyone re-deriving the same concern from better-auth's 1.7.0–1.7.2 documentation, so they can see it was considered and why it does not apply to 1.7.3.

> The template repo has no seeded accounts, so it would execute nothing. What it would owe downstream is a correct procedure. Per better-auth's 1.7 upgrade guide (describing the 1.7.0–1.7.2 `issuer` requirement, since reverted):
>
> **Step 0 — pre-check for collisions (must run before anything else):**
>
> ```sql
> SELECT "providerId", "accountId", count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;
> ```
>
> Any rows returned must be resolved first. better-auth 1.7.0–1.7.2 rejected an account lookup that matched more than one row.
>
> **Step 1 — add `issuer` as nullable.** Keep the existing `accountId` column.
>
> **Step 2 — populate both fields by account type:**
>
> | Account type | `issuer` | `accountId` |
> | --- | --- | --- |
> | Credential (password) | `local:credential` | the linked `user` row's `id` |
> | Provider with an issuer | the provider's exact trusted issuer | unchanged |
> | OAuth provider without an issuer | `local:oauth:<encoded providerId>` | unchanged |
>
> **Step 3 — verify, then constrain.** Confirm every row has both fields, make `issuer` `NOT NULL`, add the unique index on `(issuer, accountId)`.
>
> The credential row rewrite would have been the step most easily missed: `accountId` becomes the user's `id`, making this a data migration, not a column addition.

If better-auth ever reintroduces an account-identity change in a future release this workspace upgrades to, this procedure — or whatever the then-current upgrade guide specifies — is the starting point, not a fresh investigation from zero.

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

*Implementation note:* `.ncurc.json` is parsed and passed straight through as CLI options — an inline `$comment`/rationale key inside it makes `npm-check-updates` fail with "unknown option". The rationale for each rejection lives in `CORNER_CASES.md` instead; the JSON file carries only the `reject` array itself.

### D6 — Three branches, not one

**Involves:** all affected packages.

```
  feature/deps-safe-bump        low risk, no behavior change
        |                       (safe versions + .ncurc.json)
        v
  feature/better-auth-1.7.3     zod + better-auth + TwoFactor schema fix (D7)
        |                       (the reviewable core — Account unchanged, see D1/D2/D4)
        v
  feature/nestjs-pino-5         isolated major, trivially revertible
```

Sequential rather than parallel: the safe bump lands the block list first, so the later branches cannot reintroduce a rejected version. `nestjs-pino` 5 requires `pino ^10` and Node `>=22.12` — the repo is on Node 24.19, so the engine is satisfied.

`.claude/CORNER_CASES.md` gains entries in the first branch (deferred upgrades, under a build/tooling heading) and in the second (the pre-existing `test:integration` ESM fix, the `bullmq`/`pnpm dedupe` gotcha from the first branch, better-auth 1.7.3's default-on schema validation, and the `pnpm db:generate`-then-`pnpm build` requirement, all from D7).

*Note on tasks.md across branches:* the `TwoFactor` schema work (D7) was discovered and completed while `feature/nestjs-pino-5` was already checked out for its own group's work; it was moved to `feature/better-auth-1.7.3` (the branch it actually belongs to) before committing, since the two branches' base commits for the affected files were identical at that point. `tasks.md`'s task-group numbering diverges between the two branches from this point on (each branch's own commits added groups only relevant to it) and needs reconciling at merge time — a mechanical rename, not a content conflict.

### D7 — Applied: `TwoFactor` schema fix

**Involves:** `packages/database/prisma/auth.prisma`, `packages/database/prisma/migrations/`.

Discovered while verifying the better-auth 1.7.3 upgrade with a real `signUpEmail`/`signInEmail` round trip through `apps/auth`'s actual e2e suite (not the test-factory Prisma bypass most of this workspace's tests use): better-auth 1.7.3's new default-on schema validation (see Context) rejected every request once `twoFactor()` was registered, reporting `auth.prisma`'s `TwoFactor` model missing `verified`, `failedVerificationCount`, and `lockedUntil`.

```prisma
model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?  @default(true)                // added
  failedVerificationCount Int?      @default(0)                   // added
  lockedUntil             DateTime?                                // added

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}
```

*Why this is not the same situation as the withdrawn `Account.issuer` case:* diffing `@better-auth/core`'s `two-factor/schema.ts` between the installed 1.7.2 and 1.7.3 packages shows these three fields identical across both versions — they are not new. `auth.prisma` simply never had them. 1.7.2 tolerated the gap silently (the fields are `required: false`); 1.7.3's new validation now surfaces it as a hard failure. This is a real, previously-latent defect being fixed, not a reverted feature being reintroduced.

*Why regenerate `init` (per D1's reasoning, which applies here even though it did not apply to the `issuer` case):* the same distribution-model argument holds — an incremental migration would reach no existing derived project (no git relationship) while leaving new projects with an avoidable two-step history. Unlike the `issuer` case, this one is also safe to apply as an incremental migration if it ever needed to reach an existing project by other means (documentation, a script), since all three columns are nullable with database defaults — no backfill, no collision check, no data rewrite.

*Verification path, and a real gotcha hit along the way:* edited `auth.prisma`, ran `pnpm db:generate` (refreshes `packages/database/generated/prisma/*.ts` source), then attempted to verify — and hit the exact same "missing columns" error again, even though the live database already had the new columns (confirmed via direct `psql` inspection) and the generated TypeScript source was already correct. Root cause: Prisma 7's `provider = "prisma-client"` generator emits TypeScript source, not compiled JS; `packages/database`'s own `dist/generated/prisma/` (what `dist/src/index.js` actually `require()`s) is a **separately compiled copy** that only `pnpm build` refreshes. `pnpm db:generate` alone left it stale. Running `pnpm build` for `packages/database` resolved it. Documented in `CORNER_CASES.md` as a standalone gotcha, since it will bite the next schema edit too.

*Consent for the destructive step:* regenerating an already-applied migration left the local dev and test databases' migration history out of sync with the corrected migration file on disk. Prisma's own CLI refused to run `migrate reset --force` without explicit, freshly-given user consent (a built-in agent-safety guard), which was requested and given before either database was reset.

*Alternative considered:* leave the columns out and set `advanced.database.validateSchema: false` in the `betterAuth()` config to suppress the new validation instead. Rejected: this is exactly the kind of override that silences a real signal rather than respecting it (the same reasoning as D5's rejection of `pnpm.overrides` for NestJS 12) — the gap is real and the fix is free of risk, so there is no reason to mute the check that (correctly) found it.

## Risks / Trade-offs

- **The Zod override is updated but an app manifest is missed** → two resolved versions, `instanceof` identity breaks silently across packages. Mitigated by `verify-single-zod-version.mjs` as a gating step, checking the printed version and not just the exit code.
- **`.ncurc.json` blocks an upgrade long after its cause is gone** → each entry states its release condition, so the list is auditable. Accepted trade-off: it still requires someone to look.
- **Deferring NestJS 12 accumulates upgrade debt** → the four blockers are likely to clear at similar times, since they are all tracking the same major. When they do, the upgrade becomes a single coordinated change rather than four.
- **`@sentry/nestjs` 11 is in beta** → not adopted; the safe bump takes 10.74.0, the newest stable.
- **A future maintainer re-reads the original `1-7-upgrade-guide.mdx` and re-proposes the `issuer` migration** → the withdrawn D1/D2/D4 decisions and `proposal.md`'s evidence chain are kept intact (not deleted) specifically so this question resolves by reading, not by re-investigating.
- **A future better-auth upgrade reports a similar "missing columns" mismatch for a different plugin, and it gets fixed as a real schema change without checking whether the requirement is actually new** → D7's own reasoning (diff the plugin's schema source between the two installed versions before writing a migration) and the parallel CORNER_CASES.md entry both call this out explicitly, using this same investigation as the cautionary example.
- **Editing an already-applied migration requires resetting local databases, which is destructive** → gated behind explicit, freshly-given user consent each time (Prisma's own CLI enforces this for AI-driven invocations); only ever applied to disposable local databases, never to a database holding real data.

## Migration Plan

1. **`feature/deps-safe-bump`** — safe versions, `.ncurc.json`, `CORNER_CASES.md` entries for the deferred upgrades. Verify `pnpm update-packages` no longer proposes a rejected version. Full build, lint, type-check, tests.
2. **`feature/better-auth-1.7.3`** — Zod across nine locations, then better-auth packages. Verify `apps/auth`'s config still type-checks and its unit/integration suites pass; fix the pre-existing `test:integration` ESM defect uncovered along the way. Verify with a real e2e sign-up/sign-in round trip, which surfaced and required the `TwoFactor` schema fix (D7) — apply it, reset the local databases with explicit consent, rebuild `packages/database`, and confirm the e2e suite passes end to end.
3. **`feature/nestjs-pino-5`** — the major alone. Confirm log output and correlation-ID threading still behave.

**Rollback:** each branch reverts independently. No production system is involved for either the dependency bumps or the `TwoFactor` schema fix — the repo's local databases hold no real data, and the schema change itself is purely additive (nullable, defaulted columns), so it is also safe to roll forward without a rollback plan for any derived project that has already applied it.

## Open Questions

None outstanding. The one open question from the original design (whether to publish a derived-project backfill guide) is moot now that no backfill is needed.
