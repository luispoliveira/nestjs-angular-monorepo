# Env Validation

## Purpose

Defines how each app validates its own environment variables before serving traffic, so a missing or malformed configuration value fails loudly at boot or build time rather than producing a silently broken runtime.

## Requirements

### Requirement: NestJS apps fail at boot when required env vars are missing

Each NestJS application (auth, api, notifications, worker) SHALL validate its environment variables during the NestJS bootstrap phase, before any request is served. If any required variable is absent or fails type/format constraints, the process SHALL exit with a non-zero status code and a structured error message listing every invalid variable.

#### Scenario: Required variable missing at boot

- **WHEN** a NestJS app starts with `DATABASE_URL` absent from the environment
- **THEN** the process crashes immediately during bootstrap
- **THEN** the error output identifies `DATABASE_URL` as missing
- **THEN** no HTTP port is opened and no requests are accepted

#### Scenario: Variable present but malformed

- **WHEN** `REDIS_PORT` is set to `"abc"` (non-numeric string)
- **THEN** the process crashes immediately during bootstrap
- **THEN** the error output identifies `REDIS_PORT` as invalid
- **THEN** no HTTP port is opened

#### Scenario: All required variables present and valid

- **WHEN** all required env vars are present and pass their constraints
- **THEN** the app boots successfully
- **THEN** no validation error is emitted

---

### Requirement: Each NestJS app validates only its own variable surface

Each app SHALL define a Zod schema covering exactly the variables it uses. An app SHALL NOT be required to supply variables it does not consume.

#### Scenario: Worker boots without auth-specific variables

- **WHEN** the worker app starts without `BETTER_AUTH_SECRET` in the environment
- **THEN** the worker boots successfully (it does not use that variable)

#### Scenario: Auth app requires BETTER_AUTH_SECRET

- **WHEN** the auth app starts without `BETTER_AUTH_SECRET`
- **THEN** the auth app crashes at boot with an error identifying `BETTER_AUTH_SECRET`

---

### Requirement: Numeric env vars are coerced from strings

The system SHALL accept numeric environment variables (e.g. `PORT`, `REDIS_PORT`) as strings and coerce them to numbers during validation. Values that cannot be coerced to a positive integer SHALL be rejected.

#### Scenario: REDIS_PORT provided as string

- **WHEN** `REDIS_PORT` is set to `"6379"` (string form)
- **THEN** the app boots successfully and `ConfigService.get('REDIS_PORT')` returns the number `6379`

#### Scenario: REDIS_PORT is not a number

- **WHEN** `REDIS_PORT` is set to `"not-a-port"`
- **THEN** the app crashes at boot with an error identifying `REDIS_PORT`

---

### Requirement: apps/web validates env vars at module load time

The browser application (`apps/web`) SHALL expose its configuration as a schema-validated object built at build time, not read from the process environment at runtime. Validation SHALL run at the top level of that module, causing the production build to fail if any required value is missing or malformed. The application SHALL NOT depend on reading environment variables in the browser at runtime, and SHALL NOT fetch its configuration over the network before it can start.

#### Scenario: Build fails when a required config value is missing

- **WHEN** the browser application's production build runs without a required configuration value defined
- **THEN** the build process exits with a non-zero code
- **THEN** the error identifies the missing value by name

#### Scenario: Application code imports validated config

- **WHEN** any application module needs a configuration value, such as the authentication service origin
- **THEN** it imports it from the validated configuration module rather than reading the process environment
- **THEN** the value is guaranteed to satisfy its schema

#### Scenario: Same-origin API needs no configured host

- **WHEN** the application addresses its own backend API
- **THEN** it uses a relative path prefix
- **THEN** no absolute host for its own API is required in the configuration

#### Scenario: Cross-origin auth service is configured per environment

- **WHEN** the application addresses the authentication service
- **THEN** it uses an absolute origin taken from the validated configuration
- **THEN** that value differs between local, QA and production builds

---

### Requirement: No direct process.env reads inside app business logic

App code (services, modules, guards, controllers, components) SHALL NOT read `process.env` directly. All env access SHALL go through `ConfigService.get()` (NestJS apps) or the validated configuration module (browser application). The only exception is `main.ts`.

#### Scenario: Social provider credentials via ConfigService

- **WHEN** the auth app configures Google OAuth
- **THEN** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are read via `configService.get()`, not `process.env`

#### Scenario: Optional social provider not configured

- **WHEN** `GOOGLE_CLIENT_ID` is absent from the environment
- **THEN** Google OAuth is silently disabled (social provider block omitted)
- **THEN** the auth app boots successfully without requiring it

#### Scenario: Browser application reads configuration

- **WHEN** a component, guard or service in the browser application needs a configuration value
- **THEN** it imports the validated configuration module
- **THEN** it does not reference `process.env`
