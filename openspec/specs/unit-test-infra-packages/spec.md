# unit-test-infra-packages Specification

## Purpose

Ensures the mail and database packages have a working Jest setup and unit tests covering their core services.

## Requirements

### Requirement: packages/mail has a working Jest configuration

`packages/mail` SHALL have a `jest` block in `package.json` with `ts-jest` transform, 80% coverage thresholds, and `test` / `test:cov` scripts.

#### Scenario: pnpm test runs in packages/mail
- **WHEN** `pnpm test` is run inside `packages/mail`
- **THEN** Jest finds and executes all `*.spec.ts` files under `src/`

---

### Requirement: MailService is unit tested

`MailService` SHALL have unit tests covering the `send()` method with a mocked HTTP client (no real Brevo API calls).

#### Scenario: send() calls the Brevo API with correct payload
- **WHEN** `MailService.send()` is called with a mail payload
- **THEN** the underlying HTTP client (axios or fetch) is called with the correct Brevo endpoint and headers

#### Scenario: send() propagates errors from the HTTP client
- **WHEN** the HTTP client throws an error
- **THEN** `MailService.send()` propagates the error to the caller

---

### Requirement: packages/database has a working Jest configuration

`packages/database` SHALL have a `jest` block in `package.json` with `ts-jest` transform, 80% coverage thresholds, and `test` / `test:cov` scripts.

#### Scenario: pnpm test runs in packages/database
- **WHEN** `pnpm test` is run inside `packages/database`
- **THEN** Jest finds and executes all `*.spec.ts` files under `src/`

---

### Requirement: DatabaseService is unit tested

`DatabaseService` SHALL have unit tests verifying it extends `PrismaClient` and is injectable, with Prisma client mocked.

#### Scenario: DatabaseService can be instantiated in a test module
- **WHEN** `DatabaseService` is provided in a `Test.createTestingModule` with a mocked `ConfigService`
- **THEN** the module compiles without error

---

### Requirement: DatabaseSeederService is unit tested

`DatabaseSeederService` SHALL have unit tests covering the `onModuleInit` seeder execution path.

#### Scenario: onModuleInit calls registered seeders
- **WHEN** `DatabaseSeederService.onModuleInit()` is called
- **THEN** each registered seeder's `run()` method is called in order

#### Scenario: onModuleInit handles seeder errors gracefully
- **WHEN** a seeder throws during `onModuleInit()`
- **THEN** the error is logged and does not crash the remaining seeders
