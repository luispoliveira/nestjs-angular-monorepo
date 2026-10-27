# Corner cases — Database (Prisma / PrismaPg)

## Partial unique indexes must be declared in the schema (`partialIndexes` preview), never hand-written into a migration

**Context:** `Customer.taxIdHash` has to be unique only among non-deleted rows (`WHERE "deletedAt" IS NULL`).

**Gotcha:** if you hand-write a `CREATE UNIQUE INDEX ... WHERE ...` into a migration's SQL, the Prisma schema doesn't know the index exists. The next `prisma migrate dev` detects drift and generates a `DROP INDEX` for it.

**Fix:** since Prisma 7.4, enable `previewFeatures = ["partialIndexes"]` on the generator and declare `@@unique([taxIdHash], where: { deletedAt: null })`. The generated migration contains the `WHERE ("deletedAt" IS NULL)` clause, and `migrate dev --create-only` then produces an empty migration, which confirms there is no drift. This is a preview feature: if it is ever removed, fall back to raw SQL **and** expect to re-apply it after every drift-triggered regeneration. Columns are camelCase here (no field `@map`), so a `raw(...)` predicate must quote `"deletedAt"`.

## `pnpm db:generate` alone is not enough after editing `auth.prisma` — `packages/database` must also be rebuilt

**Symptom:** after editing `packages/database/prisma/auth.prisma` and running `pnpm db:generate`, a Prisma-backed feature (e.g. better-auth's own runtime schema validation, new in 1.7.3 — see the Authentication section) still reports the *old* schema, even though the freshly generated `packages/database/generated/prisma/**/*.ts` source on disk is correct and the live database has the new columns.

**Cause:** Prisma 7's `provider = "prisma-client"` generator (unlike the old `prisma-client-js`) emits TypeScript **source**, not compiled JS, into `generated/prisma/`. `packages/database`'s own package entry point (`dist/src/index.js`, built by `tsc -p tsconfig.build.json`) re-exports from `../generated/prisma/client` — a path resolved *relative to `dist/src/`*, i.e. `dist/generated/prisma/client.js`, a **separately compiled copy** produced by `packages/database`'s own build step, not the `generated/prisma/*.ts` source tree that `prisma generate` just refreshed. `pnpm db:generate` never touches `dist/`; only `pnpm build` (or `pnpm --filter @repo/database build`) does.

**Fix:** always run `pnpm build` for `packages/database` after `pnpm db:generate` whenever `auth.prisma` (or any Prisma schema) changes, before any consumer (`apps/auth`, tests, a running app) can see the new fields. Verify directly if in doubt: `grep -c "<new field name>" packages/database/dist/generated/prisma/internal/class.js` — zero means the compiled copy is stale regardless of what the source or the live database say. This bit twice in the same investigation: first the live-DB reset alone didn't fix a schema-mismatch error from better-auth's new 1.7.3 validation, and only rebuilding `packages/database` did.

## If a future schema correction must reach every template consumer, regenerate `init` — not a currently-applied exception

**Context:** the project rule is "schema changes → new migration, never edit migrations already applied" (see the root `CLAUDE.md`), and it exists to protect *live systems*, where an already-applied migration is a historical record of what actually ran against real data. This repo is a **GitHub template repository**: it is consumed by copy (`Use this template` / `degit`), not by `git merge` or `git pull` from an upstream remote. A project created from the template diverges from it the moment it is created and never receives anything from the template's git history again.

Under that distribution model, an incremental migration added here would reach **zero** consumers: a new project copies whatever `init` looks like on the day it is created, and an already-existing derived project has no git relationship to this repo through which the new migration file could ever arrive.

**Policy, not yet exercised:** if a schema correction is ever needed that applies to *every* future consumer of the template, regenerate the single `20260313155633_init` migration in place instead of adding a second one — that keeps new projects on a one-step history for a schema that is simply correct from the start. This was evaluated concretely for a better-auth account-identity change during the `update-monorepo-dependencies` change and **not applied**: the investigation found better-auth had reverted that schema requirement before the version this workspace upgraded to, so `auth.prisma` needed no correction. See `openspec/changes/update-monorepo-dependencies/design.md` (decisions D1/D2/D4, marked withdrawn) and `proposal.md`'s evidence chain for that specific case, kept for anyone re-deriving the same question later.

**What this would NOT change, if ever exercised:** an already-existing derived project (which has its own independent migration history) still could not receive such a change via a migration file — it never receives one. It would need a documented backfill *procedure* instead.

**Do not** apply this exception to a project that has been created *from* this template and is now itself a live system with real users — at that point the normal rule applies, because the distribution model that would justify the exception (no consumer ever receives the migration) does not hold for it.

## The seeder can hit `ECONNREFUSED` on a cold boot, on a healthy Postgres

**Symptom:** an app that seeds on boot occasionally crashes at startup with `ECONNREFUSED` from its own seeder even though Postgres is up.

**Cause:** the `PrismaPg` driver adapter can refuse the very first query issued right after `$connect()` resolves (a connection-pool race; root cause unconfirmed).

**Fix:** `DatabaseSeederService.onModuleInit` wraps the run in `withRetry` (3 attempts, `attempt × 500 ms` back-off, a warning per failed attempt, the last error rethrown). Because the whole sequence is retried, every step added to `seed()` **must be idempotent** (find-or-skip on a natural key).

## `PushSubscription` adds a relation to better-auth's `User` model in `auth.prisma`

`auth.prisma` is owned by better-auth, but Prisma needs the back-relation field on `User` (`pushSubscriptions PushSubscription[]`) for `PushSubscription.user` to compile. That one field is the only edit this template makes to `auth.prisma` (it carries a comment saying so). It is not a column — the table gets its FK from the `push_subscription` migration — so better-auth never sees it. If `auth.prisma` is ever regenerated from better-auth's CLI, **re-add that line** or `prisma generate` fails with "missing the opposite relation field". The FK is `ON DELETE CASCADE`, so deleting a user deletes their subscriptions. After touching `auth.prisma`, rebuild `packages/database` (see the `db:generate` entry above).

## `prisma migrate dev` cannot run non-interactively — diff the schema instead

Without a database to hand (CI, a sandbox), generate the SQL with `prisma migrate diff --from-schema <old schema dir> --to-schema ./prisma --script`, save the old `prisma/` files first, and write the output to `prisma/migrations/<timestamp>_<name>/migration.sql`. It is the same SQL `migrate dev` would write; confirm it by running `pnpm db:migrate` once against a real database.

## A real `P2002` under `PrismaPg` has no `meta.target`

Through the `PrismaPg` driver adapter the violated index is at `error.meta.driverAdapterError.cause.constraint.index` (e.g. `'customer_taxIdHash_key'`); `meta.target` is absent. Mock-based specs fabricate the classic `target` shape, so they pass while the real request answers 500 instead of 409. `CustomersService.mapUniqueViolation` only checks `error.code === 'P2002'`, which is safe with one unique index. A model with several must tell them apart by `constraint.index` (substring of the column name), with a fallback to `target`, and be verified against a real violation in an integration test, not a mock.

## A raw-SQL `CHECK` constraint is invisible to Prisma — its only witness is a direct-insert test

Prisma cannot declare a table `CHECK`, so one has to be hand-appended to the generated migration, and a later reset that drops it passes every gate. Give each its own integration test that inserts around the API with `db.$executeRaw` and expects Postgres `23514` (surfaced as `P2010`); the raw insert bypasses `@updatedAt`, so include `updatedAt` or it fails on `NOT NULL` first. To widen a `CHECK`: `DROP CONSTRAINT`, then `ADD CONSTRAINT` under the same name (Postgres has no `ALTER ... CHECK`). On free-text columns guard with `btrim(col) <> ''` as well as `IS NOT NULL`, or `'   '` satisfies the database while failing the Zod refinement.

## `pg_advisory_xact_lock` must be called through `$executeRaw`, not `$queryRaw`

It returns `void`, and `$queryRaw` throws `Failed to deserialize column of type 'void'`. Call `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(${key})\`` inside the transaction; the lock is released at commit. A concurrency test that races two writers and asserts exactly one wins is the only proof it works.

## No `Promise.all` on a transaction's `tx`

An interactive `$transaction`'s `tx` is a single pg connection. `Promise.all` over it logs `DeprecationWarning: Calling client.query() when the client is already executing a query` (an error in pg@9). Any helper that takes the client as a parameter (`client: Db = this.db`) must `await` its queries sequentially.

## `pnpm db:seed` is a no-op — the seeder runs when an app that imports `DatabaseSeederModule` boots

The root `db:seed` script is `turbo db:seed`, but no workspace defines a `db:seed` task, so it exits green having done nothing. Seeding happens in `DatabaseSeederService.onModuleInit` of an app that imports `DatabaseSeederModule` (`apps/api`): boot that app (`pnpm --filter api dev`). An integration test never boots the whole app, so any row that only the seeder creates must be created by the suite itself, in its own `beforeAll`/`beforeEach`.

## Use an enum value added by `ALTER TYPE ... ADD VALUE` only in a later migration

PostgreSQL refuses to *use* an enum value added in a transaction that is still open (`unsafe use of new value`, SQLSTATE 55P04) — in a default, a `CHECK`, a partial index's `WHERE` or an `UPDATE`. Whether it works today depends on whether the migration runs inside a transaction, which is not something to rely on. A migration that adds a value should only add it; anything that must reference the new value goes in a following migration.

## Making a relation optional changes Prisma's expected FK action to `ON DELETE SET NULL`

A required relation's foreign key is `ON DELETE RESTRICT`. Making it optional (`owner Owner?`) makes Prisma expect `ON DELETE SET NULL`, so `prisma migrate diff` reports a difference unless the migration drops and re-adds the constraint. Write that in the same migration, together with the `@@index` the foreign key needs if it was missing, even if rows are only ever soft-deleted and the action never fires: it keeps the schema and the database from drifting.

## A `\s` inside a `$queryRaw` template literal reaches Postgres as `s`

`$queryRaw` is a tagged template and uses the cooked string, so `regexp_replace("phone", '\s', '', 'g')` strips the letter `s`, not whitespace, and a match with different spacing fails silently. Use `'[[:space:]]'`, or pass the pattern as a bound parameter.
