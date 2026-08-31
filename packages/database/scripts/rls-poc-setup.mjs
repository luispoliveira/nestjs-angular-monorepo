#!/usr/bin/env node
/**
 * Provisions the unprivileged role the RLS proof of concept connects as.
 *
 * The role in docker/postgres.env is the database superuser, and superusers
 * ignore row-level security entirely. Any RLS test that connects as it passes
 * for the wrong reason. This creates a plain LOGIN role instead.
 *
 * Usage: node packages/database/scripts/rls-poc-setup.mjs [--database nestjs_test]
 * Prerequisites: Postgres running (pnpm docker:up)
 *
 * ponytail: password is hardcoded because this only ever runs against a local
 * container. Real environments provision the role out of band, with the
 * credentials in the secret store.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const RLS_ROLE = 'app_rls';
export const RLS_PASSWORD = 'app_rls';

function loadEnvVar(envFile, key) {
  try {
    const content = readFileSync(resolve(ROOT, envFile), 'utf8');
    const match = content.match(
      new RegExp(`^${key}=["']?([^"'\n]+)["']?`, 'm'),
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const baseUrl =
  process.env.DATABASE_URL ||
  loadEnvVar('apps/auth/.env', 'DATABASE_URL') ||
  loadEnvVar('packages/database/.env', 'DATABASE_URL');

if (!baseUrl) {
  console.error('Error: DATABASE_URL not found.');
  process.exit(1);
}

const dbFlagIndex = process.argv.indexOf('--database');
const targetDatabase =
  dbFlagIndex !== -1 ? process.argv[dbFlagIndex + 1] : 'nestjs_test';

/** Same connection string, pointed at another database. */
export function urlForDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Same connection string, as the unprivileged RLS role. */
export function rlsUrl(url, database = targetDatabase) {
  const parsed = new URL(urlForDatabase(url, database));
  parsed.username = RLS_ROLE;
  parsed.password = RLS_PASSWORD;
  return parsed.toString();
}

async function main() {
  const client = new pg.Client({
    connectionString: urlForDatabase(baseUrl, targetDatabase),
  });
  await client.connect();

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
        CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}';
      END IF;
    END
    $$;
  `);

  // Explicitly not a superuser and explicitly not BYPASSRLS. If either were
  // set, the policies would be decoration.
  await client.query(`ALTER ROLE ${RLS_ROLE} NOSUPERUSER NOBYPASSRLS`);

  await client.query(
    `GRANT CONNECT ON DATABASE "${targetDatabase}" TO ${RLS_ROLE}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RLS_ROLE}`,
  );

  const { rows } = await client.query(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
    [RLS_ROLE],
  );
  if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
    throw new Error(
      `Role ${RLS_ROLE} can bypass RLS. The proof of concept would be meaningless.`,
    );
  }

  console.log(
    `Role ${RLS_ROLE} ready on ${targetDatabase} (superuser: no, bypassrls: no)`,
  );
  await client.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
