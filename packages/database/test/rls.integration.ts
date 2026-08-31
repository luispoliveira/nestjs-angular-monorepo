import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { assertRlsEnforceable, forTenant } from '../src/rls';

/**
 * Proves that tenant isolation is enforced by PostgreSQL, not by application
 * code. Every test here must fail if the RLS policy is dropped.
 *
 * Prerequisites:
 *   pnpm docker:up
 *   pnpm test:db:setup
 *   node packages/database/scripts/rls-poc-setup.mjs
 */

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function urlFor(database: string, user?: { name: string; password: string }) {
  const base =
    process.env.DATABASE_URL ??
    'postgres://nestjs:nestjs@localhost:5432/nestjs?schema=public';
  const parsed = new URL(base);
  parsed.pathname = `/${database}`;
  if (user) {
    parsed.username = user.name;
    parsed.password = user.password;
  }
  return parsed.toString();
}

function clientFor(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

describe('row-level security — tenant isolation', () => {
  // Owner of the tables. Seeds data and cleans up. FORCE ROW LEVEL SECURITY
  // applies to owners too, so this one is a superuser on purpose: it is the
  // migration/seed path, not the application path.
  let owner: PrismaClient;
  // What the application connects as: no superuser, no BYPASSRLS.
  let app: PrismaClient;

  beforeAll(async () => {
    owner = clientFor(urlFor('nestjs_test'));
    app = clientFor(
      urlFor('nestjs_test', { name: 'app_rls', password: 'app_rls' }),
    );
  });

  beforeEach(async () => {
    await owner.$executeRawUnsafe('TRUNCATE TABLE "rls_note"');
    await owner.rlsNote.createMany({
      data: [
        { organizationId: ORG_A, body: 'a1' },
        { organizationId: ORG_A, body: 'a2' },
        { organizationId: ORG_B, body: 'b1' },
      ],
    });
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe('TRUNCATE TABLE "rls_note"');
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('the unprivileged role cannot bypass RLS', async () => {
    const [role] = await app.$queryRawUnsafe<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );

    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it('the startup guard accepts the restricted role', async () => {
    await expect(assertRlsEnforceable(app)).resolves.toBeUndefined();
  });

  it('the startup guard rejects a role that bypasses RLS', async () => {
    // The failure this guard exists for: shipping with the migration
    // credentials. Every other test in this file would still pass.
    await expect(assertRlsEnforceable(owner)).rejects.toThrow(
      /bypasses row-level security/,
    );
  });

  it('sees nothing without a tenant in context', async () => {
    // The failure mode that matters: a forgotten filter must return zero rows,
    // never everybody's rows.
    await expect(app.rlsNote.findMany()).resolves.toEqual([]);
  });

  it('sees only its own rows', async () => {
    const a = await forTenant(app, ORG_A).rlsNote.findMany();
    const b = await forTenant(app, ORG_B).rlsNote.findMany();

    expect(a.map((n) => n.body).sort()).toEqual(['a1', 'a2']);
    expect(b.map((n) => n.body)).toEqual(['b1']);
  });

  it('cannot read another tenant row by id', async () => {
    const [rowOfB] = await forTenant(app, ORG_B).rlsNote.findMany();

    const stolen = await forTenant(app, ORG_A).rlsNote.findUnique({
      where: { id: rowOfB.id },
    });

    expect(stolen).toBeNull();
  });

  it('cannot write a row belonging to another tenant', async () => {
    await expect(
      forTenant(app, ORG_A).rlsNote.create({
        data: { organizationId: ORG_B, body: 'smuggled' },
      }),
    ).rejects.toThrow();

    const all = await owner.rlsNote.findMany();
    expect(all).toHaveLength(3);
  });

  it('cannot update or delete another tenant row', async () => {
    const [rowOfB] = await forTenant(app, ORG_B).rlsNote.findMany();

    const updated = await forTenant(app, ORG_A).rlsNote.updateMany({
      where: { id: rowOfB.id },
      data: { body: 'tampered' },
    });
    const deleted = await forTenant(app, ORG_A).rlsNote.deleteMany({
      where: { id: rowOfB.id },
    });

    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const survivor = await owner.rlsNote.findUnique({
      where: { id: rowOfB.id },
    });
    expect(survivor?.body).toBe('b1');
  });

  it('does not leak the tenant to the next query on a pooled connection', async () => {
    // The real risk of the SET-a-variable approach: a value that outlives its
    // transaction and bleeds into whoever gets that connection next.
    await forTenant(app, ORG_A).rlsNote.findMany();

    await expect(app.rlsNote.findMany()).resolves.toEqual([]);
  });

  it('isolates concurrent tenants sharing the pool', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        forTenant(app, i % 2 === 0 ? ORG_A : ORG_B).rlsNote.findMany(),
      ),
    );

    results.forEach((rows, i) => {
      const expected = i % 2 === 0 ? [ORG_A, ORG_A] : [ORG_B];
      expect(rows.map((r) => r.organizationId)).toEqual(expected);
    });
  });
});
