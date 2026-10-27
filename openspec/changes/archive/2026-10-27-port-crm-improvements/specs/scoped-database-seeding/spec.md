# Spec Delta

## ADDED Requirements

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
