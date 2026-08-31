import { PrismaClient } from '../generated/prisma/client';

/**
 * Name of the PostgreSQL session variable the RLS policies read.
 * Must match the policy definition in the migration.
 */
export const TENANT_SETTING = 'app.current_tenant_id';

/**
 * Wraps a Prisma client so that every query runs inside a transaction that
 * first sets the tenant for the RLS policies.
 *
 * `set_config(..., TRUE)` is transaction-local, so the value cannot leak to the
 * next user of a pooled connection.
 *
 * The database is what enforces isolation. This helper only supplies the tenant
 * id; forgetting to use it means seeing nothing, never seeing someone else's
 * rows.
 */
/**
 * Fails when the connected role can ignore row-level security.
 *
 * Superusers and roles with BYPASSRLS skip every policy, FORCE included, so an
 * application deployed with such credentials has isolation on paper only. The
 * test suite cannot catch this: it connects as a restricted role by design.
 * The only place that can catch it is startup, against the real credentials.
 */
export async function assertRlsEnforceable(prisma: PrismaClient) {
  const [role] = await prisma.$queryRaw<
    { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`;

  if (!role) {
    throw new Error('Could not read the privileges of the connected role.');
  }

  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Database role "${role.current_user}" bypasses row-level security ` +
        `(superuser: ${role.rolsuper}, bypassrls: ${role.rolbypassrls}). ` +
        'Tenant isolation would not be enforced. Connect as a restricted role ' +
        'and keep the privileged one for migrations and seeds.',
    );
  }
}

export function forTenant<T extends PrismaClient>(prisma: T, tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
