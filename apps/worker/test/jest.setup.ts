import { E2E_CONTAINERS_RUN_ID_ENV } from '@repo/testing-utils';

// REDIS_HOST/REDIS_PORT (and the databases) come only from the ephemeral
// containers started by globalSetup — never from an .env file or a localhost
// fallback, so a suite can't reach a developer's own Redis queues.
if (!process.env[E2E_CONTAINERS_RUN_ID_ENV]) {
  throw new Error(
    'Test containers were not provisioned: run this suite through ' +
      'test/jest-integration.json (it sets globalSetup).',
  );
}
