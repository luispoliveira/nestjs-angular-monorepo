# Spec Delta

## ADDED Requirements

### Requirement: Integration and E2E runs provision their own ephemeral backing services

Every `test:integration` and `test:e2e` run SHALL start its own disposable PostgreSQL, MongoDB and Redis instances, apply all committed Prisma migrations to the PostgreSQL instance, point the suites at them, and remove them when the run ends. No suite SHALL require a database, Mongo or Redis instance to be running beforehand.

#### Scenario: Suites run with no local infrastructure

- **WHEN** `pnpm test:integration` or `pnpm test:e2e` is run in `apps/auth` with Docker available and no local Postgres, MongoDB or Redis running
- **THEN** the suites start, run against freshly migrated ephemeral instances, and pass

#### Scenario: A developer database is never touched

- **WHEN** a developer has their own Postgres on `localhost:5432` containing data (including a database named `nestjs_test`) and runs the suites
- **THEN** that data is unchanged after the run

#### Scenario: Instances are removed after the run

- **WHEN** a test run finishes, whether its tests passed or failed
- **THEN** no container started by that run is still present

#### Scenario: Docker is unavailable

- **WHEN** the suites are run and Docker is not reachable
- **THEN** the run fails before any test executes, with an error naming the missing container runtime

### Requirement: Test env files carry no connection targets

Each NestJS app that has integration or E2E suites SHALL include a `.env.test` file (committed, containing no secrets) with the non-connection settings those suites need. It SHALL NOT set `DATABASE_URL`, `MONGO_URI`, `REDIS_HOST` or `REDIS_PORT`; those come from the ephemeral instances provisioned for the run.

#### Scenario: .env.test has no connection variables

- **WHEN** `apps/auth/.env.test` is read
- **THEN** it contains no `DATABASE_URL`, `MONGO_URI`, `REDIS_HOST` or `REDIS_PORT` line

### Requirement: Jest setupFiles preserve the provisioned connections

Each app's `test/jest.setup.ts` SHALL load `.env.test` values into `process.env` before `ConfigModule.forRoot()` reads them, SHALL NOT replace or default the connection variables provisioned for the run, and SHALL abort the run when those were not provisioned.

#### Scenario: Suites connect to the ephemeral database

- **WHEN** an integration or E2E suite starts a NestJS `TestingModule`
- **THEN** `DatabaseService` connects to the PostgreSQL instance provisioned for that run, not to any database named in an `.env` or `.env.test` file

#### Scenario: Jest run without provisioning

- **WHEN** a suite is started through a Jest config that does not provision the ephemeral instances
- **THEN** the run aborts before any test executes, stating that the provisioning setup is required

## REMOVED Requirements

### Requirement: pnpm test:db:setup provisions the test database

**Reason**: A long-lived, shared `nestjs_test` database on the developer's Postgres is exactly what the suites wipe; each run now provisions and migrates its own instance.
**Migration**: Remove any `pnpm test:db:setup` step from local routines; running `pnpm test:integration` / `pnpm test:e2e` with Docker available is sufficient. An existing `nestjs_test` database is no longer used and may be dropped.

### Requirement: Each app has a .env.test file for test environment variables

**Reason**: Its only scenario required `.env.test` to point `DATABASE_URL` at `nestjs_test`, which is what made the suites reach a developer database.
**Migration**: Replaced by "Test env files carry no connection targets"; delete connection variables from `.env.test`.

### Requirement: Jest setupFiles override process.env before module init

**Reason**: Overriding `process.env` from `.env.test` clobbers the connection variables provisioned for the run.
**Migration**: Replaced by "Jest setupFiles preserve the provisioned connections".
