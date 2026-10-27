# scoped-database-seeding Specification

## Purpose

Ensures database seeding only executes where it is explicitly wired in, instead of running as an implicit side effect of every app's startup.

## Requirements

### Requirement: Seeding runs only in apps that explicitly opt in
The database-seeding step SHALL execute only in an app that explicitly imports the seeding capability; it SHALL NOT run automatically as a side effect of shared database infrastructure.

#### Scenario: An app that imports the seeding capability boots
- **WHEN** an app that explicitly imports the seeding capability starts
- **THEN** the seeding step runs during that app's startup

#### Scenario: An app that does not import the seeding capability boots
- **WHEN** an app that does not import the seeding capability starts (but still uses the shared database connection)
- **THEN** no seeding step runs during that app's startup, and no seeding-related log lines are emitted

### Requirement: Seeding retries transient failures
When a seeding run fails, the seeding step SHALL retry the whole run up to 3 attempts in total, waiting longer before each retry, and SHALL log each failed attempt as a warning. If the last attempt fails, the error SHALL surface and SHALL NOT be swallowed. Every seeding step SHALL be idempotent so a retry is safe.

#### Scenario: Cold-start connection refused
- **WHEN** the first seeding attempt fails with a refused database connection and the second succeeds
- **THEN** the app finishes booting with the seed applied
- **AND** one warning naming the failed attempt is logged

#### Scenario: Persistent failure
- **WHEN** all 3 seeding attempts fail
- **THEN** the error of the last attempt is raised

#### Scenario: Retry after a partial run
- **WHEN** an attempt fails after some rows were already seeded and the next attempt succeeds
- **THEN** no seeded row is duplicated
