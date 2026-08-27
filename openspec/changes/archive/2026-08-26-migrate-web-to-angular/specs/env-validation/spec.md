## MODIFIED Requirements

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

#### Scenario: Browser application reads configuration

- **WHEN** a component, guard or service in the browser application needs a configuration value
- **THEN** it imports the validated configuration module
- **THEN** it does not reference `process.env`
