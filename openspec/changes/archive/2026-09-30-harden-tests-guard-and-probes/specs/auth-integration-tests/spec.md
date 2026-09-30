# Spec Delta

## MODIFIED Requirements

### Requirement: Integration tests use a lean TestingModule with real Postgres

Auth integration tests SHALL create a NestJS `TestingModule` importing only `ConfigModule.forRoot()` and `DatabaseModule`, with `MongoService` replaced by a jest mock object. They SHALL NOT bootstrap `SharedModule`, `AuthModule`, or any microservice client. The Postgres they use SHALL be the ephemeral instance provisioned for the run.

#### Scenario: Integration test module connects to the test database

- **WHEN** a `TestingModule` with `DatabaseModule` is compiled in an integration test
- **THEN** `DatabaseService` connects to the ephemeral PostgreSQL instance provisioned for the run
- **THEN** no MongoDB or Redis connection is attempted

#### Scenario: MongoService is mocked in integration tests

- **WHEN** a service under test calls a `MongoService` method
- **THEN** the mock implementation is invoked and no real MongoDB connection error is thrown

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
