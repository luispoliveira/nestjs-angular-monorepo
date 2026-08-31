# RLS proof of concept

Proves that multi-tenant isolation can be enforced by PostgreSQL rather than by
application code, on this template's stack: Prisma 7 with the `@prisma/adapter-pg`
driver adapter.

## Run it

```bash
pnpm docker:up
cd packages/database
DATABASE_URL="postgres://nestjs:nestjs@localhost:5432/nestjs_test?schema=public" \
  pnpm exec prisma migrate deploy
node scripts/rls-poc-setup.mjs --database nestjs_test
pnpm test:integration
```

Create `nestjs_test` first if it does not exist. The repo's `pnpm test:db:setup`
does that, but it currently fails: it imports `pg`, which pnpm installs only under
`packages/database/node_modules`, so a script under the root `scripts/` cannot
resolve it. Unrelated to this branch.

## How it works

Two halves that only work together.

Database, in `prisma/migrations/20260831120000_rls_poc/migration.sql`:

```sql
ALTER TABLE "rls_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rls_note" FORCE ROW LEVEL SECURITY;

CREATE POLICY "rls_note_tenant_isolation" ON "rls_note"
    USING ("organization_id" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organization_id" = current_setting('app.current_tenant_id', true));
```

Client, in `src/rls.ts`: a Prisma extension that wraps every operation in a
transaction which first calls `set_config('app.current_tenant_id', ..., TRUE)`.
The `TRUE` makes the setting transaction-local, so it cannot survive into the
next user of a pooled connection.

```ts
const notes = await forTenant(prisma, organizationId).rlsNote.findMany();
```

## What the tests prove

Ten tests in `rls.integration.ts`:

- the role used by the tests cannot bypass RLS, and the startup guard accepts it
- the startup guard rejects the privileged role
- no tenant in context returns zero rows, never everyone's rows
- each tenant reads only its own rows, including by primary key
- writing a row for another tenant is rejected by `WITH CHECK`
- updating or deleting another tenant's row affects zero rows
- the tenant does not leak to the next query on the same pooled connection
- twenty interleaved queries from two tenants stay isolated

Verified that they detect breakage rather than passing by luck: with
`ALTER TABLE "rls_note" DISABLE ROW LEVEL SECURITY`, seven of them fail.

## The part that will bite in production

The protection comes from the role the application connects as, not from the
policy alone. Superusers and roles with `BYPASSRLS` ignore row-level security
completely, `FORCE` included.

The role in `docker/postgres.env` is exactly such a role:

```
nestjs   rolsuper=t  rolbypassrls=t
app_rls  rolsuper=f  rolbypassrls=f
```

An application deployed with the `nestjs` credentials has policies that are pure
decoration, and every test here would still pass because they connect as
`app_rls`. So: migrations and seeds run as the owner, the application runs as a
restricted role, and that split is a deployment requirement, not a code one.

### The startup guard

`assertRlsEnforceable()` in `src/rls.ts` reads `pg_roles` for the connected role
and throws if it is a superuser or has `BYPASSRLS`. `DatabaseService` calls it on
`onModuleInit` when `DATABASE_REQUIRE_RLS=true`, so the application refuses to
start on credentials that would silently disable isolation. Off by default:
projects built on this template that are not multi-tenant should not inherit it.

Two tests cover it, and the one that matters is the second: the guard rejects the
privileged role. Without that test there is no evidence the guard catches the
failure it exists for.

`FORCE` still earns its line. It covers the case where the application connects
as the table owner without being a superuser, which is otherwise a silent bypass.

## Ceilings

- One table. RN-10 of the requirements wants a leak test per table, which should
  be generated from the schema rather than hand-written.
- The per-query cost of the extra transaction and round trip has not been
  measured.
- No integration with the request lifecycle yet. Something has to put the current
  organization on the request and hand it to `forTenant`. Better Auth's
  `organization()` plugin exposes `activeOrganizationId` on the session, which is
  the intended source. The template does not enable that plugin yet.
