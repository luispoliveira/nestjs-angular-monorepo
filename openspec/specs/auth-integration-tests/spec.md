# Auth Integration Tests

## Purpose

Defines the test requirements for auth integration and end-to-end coverage using a real PostgreSQL test database, lean NestJS integration modules, and full AppModule HTTP tests.

---

## Requirements

### Requirement: Integration tests use a lean TestingModule with real Postgres

Auth integration tests SHALL create a NestJS `TestingModule` importing only `ConfigModule.forRoot()` and `DatabaseModule`, with `MongoService` replaced by a jest mock object. They SHALL NOT bootstrap `SharedModule`, `AuthModule`, or any microservice client. The Postgres they use SHALL be the ephemeral instance provisioned for the run.

#### Scenario: Integration test module connects to the test database

- **WHEN** a `TestingModule` with `DatabaseModule` is compiled in an integration test
- **THEN** `DatabaseService` connects to the ephemeral PostgreSQL instance provisioned for the run
- **THEN** no MongoDB or Redis connection is attempted

#### Scenario: MongoService is mocked in integration tests

- **WHEN** a service under test calls a `MongoService` method
- **THEN** the mock implementation is invoked and no real MongoDB connection error is thrown

### Requirement: Database is truncated after each integration test

The integration test suite SHALL call `truncateDatabase(db)` in an `afterEach` hook so that each test starts with an empty database.

#### Scenario: Test isolation between two consecutive tests

- **WHEN** test A creates a user and test B runs immediately after
- **THEN** test B finds no pre-existing users in the database

---

### Requirement: Integration tests cover user creation via DatabaseService

The auth integration test suite SHALL include tests that exercise `DatabaseService` directly to verify that factory-created records match expected shapes.

#### Scenario: Created user has expected fields

- **WHEN** `createUser(db, { role: RoleEnum.ADMIN })` is called
- **THEN** `db.user.findUnique({ where: { email } })` returns a record with `role = 'admin'` and `emailVerified = false`

#### Scenario: Duplicate email is rejected by the database

- **WHEN** `createUser(db, { email: 'dup@example.com' })` is called twice
- **THEN** the second call throws a Prisma unique constraint violation error

---

### Requirement: E2E tests use the full AppModule with supertest

Auth E2E tests SHALL compile the full `AppModule`, mount it with the same global prefix and route exclusions that `apps/auth` uses in production, call `app.init()`, and make HTTP requests via `supertest` against the live NestJS application.

#### Scenario: Health endpoint returns 200

- **WHEN** a GET request is made to `/api/health/live`
- **THEN** the response status is 200

#### Scenario: Protected route rejects unauthenticated request

- **WHEN** a GET request is made to a protected route without a session cookie
- **THEN** the response status is 401

#### Scenario: Protected route accepts a valid injected session

- **WHEN** a user and session are created via factories and the session token is sent as the `better-auth.session_token` cookie
- **THEN** the response status is 200 and the user payload is returned

### Requirement: E2E test suite tears down the application after all tests

The E2E test suite SHALL call `app.close()` in an `afterAll` hook to release database connections and prevent open handles in Jest.

#### Scenario: Jest exits cleanly after E2E suite

- **WHEN** the E2E test suite completes
- **THEN** Jest exits without the `--forceExit` flag
- **THEN** no "open handles" warning is emitted
