import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { E2E_CONTAINERS_RUN_ID_ENV, E2E_RUN_LABEL } from './constants';

export default async function globalSetup(): Promise<void> {
  const runId = String(process.pid);

  const postgres = await new PostgreSqlContainer('postgres:17-alpine')
    .withLabels({ [E2E_RUN_LABEL]: runId })
    .start();

  const mongo = await new GenericContainer('mongo:6.0')
    .withExposedPorts(27017)
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .withLabels({ [E2E_RUN_LABEL]: runId })
    .start();

  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withLabels({ [E2E_RUN_LABEL]: runId })
    .start();

  const databaseUrl = `${postgres.getConnectionUri()}?schema=public`;
  const mongoUri = `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}`;

  // Applies the committed migrations to the ephemeral container.
  execSync('pnpm --filter @repo/database db:migrate:deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    timeout: 120_000,
  });

  process.env.DATABASE_URL = databaseUrl;
  process.env.MONGO_URI = mongoUri;
  process.env.REDIS_HOST = redis.getHost();
  process.env.REDIS_PORT = String(redis.getMappedPort(6379));
  process.env[E2E_CONTAINERS_RUN_ID_ENV] = runId;
}
