import { PrismaClient } from '@repo/database';

export async function truncateDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRaw`DELETE FROM "customer"`;
  await db.$executeRaw`DELETE FROM "verification"`;
  await db.$executeRaw`DELETE FROM "user"`;
}
