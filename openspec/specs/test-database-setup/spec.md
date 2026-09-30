# Test Database Setup

## Purpose

Defines how the monorepo provisions, configures, and selects the PostgreSQL test database for integration and end-to-end test suites.

---

## Requirements

### Requirement: Separate jest-integration.json and jest-e2e.json configs per app

Each app SHALL have two Jest config files in its `test/` directory:
- `jest-integration.json` — matches `*.integration.ts` files, uses Pattern B (no HTTP server)
- `jest-e2e.json` — matches `*.e2e-spec.ts` files, uses Pattern A (full AppModule + HTTP)

Both SHALL reference `tsconfig.test.json` for transformation and `test/jest.setup.ts` via `setupFiles`.

#### Scenario: test:integration runs only integration test files

- **WHEN** `pnpm test:integration` is run in `apps/auth`
- **THEN** only files matching `*.integration.ts` are executed
- **THEN** no E2E spec files are executed

#### Scenario: test:e2e runs only E2E test files

- **WHEN** `pnpm test:e2e` is run in `apps/auth`
- **THEN** only files matching `*.e2e-spec.ts` are executed

---

### Requirement: Root package.json exposes test:integration and test:e2e scripts

The monorepo root `package.json` SHALL include `test:integration` and `test:e2e` scripts that delegate to all apps via Turborepo.

#### Scenario: Root test:integration triggers all app integration tests

- **WHEN** `pnpm test:integration` is run from the repo root
- **THEN** Turborepo executes the `test:integration` script in each app that defines it

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
