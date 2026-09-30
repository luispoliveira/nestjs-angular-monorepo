import { E2E_CONTAINERS_RUN_ID_ENV } from '@repo/testing-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

// DATABASE_URL, MONGO_URI, REDIS_HOST and REDIS_PORT come only from the
// ephemeral containers started by globalSetup — never from an .env file or a
// localhost fallback, so a suite can't reach a developer's own databases.
if (!process.env[E2E_CONTAINERS_RUN_ID_ENV]) {
  throw new Error(
    'Test containers were not provisioned: run this suite through the ' +
      'jest-integration.json / jest-e2e.json configs (they set globalSetup).',
  );
}

dotenv.config({
  // process.cwd() is the package root (apps/auth/) in both CJS and ESM modes
  path: path.resolve(process.cwd(), '.env.test'),
  override: true,
});

process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  'test-secret-for-jest-do-not-use-in-production';
