## Purpose

Ensures database seeding only executes where it is explicitly wired in, instead of running as an implicit side effect of every app's startup.

## ADDED Requirements

### Requirement: Seeding runs only in apps that explicitly opt in
The database-seeding step SHALL execute only in an app that explicitly imports the seeding capability; it SHALL NOT run automatically as a side effect of shared database infrastructure.

#### Scenario: An app that imports the seeding capability boots
- **WHEN** an app that explicitly imports the seeding capability starts
- **THEN** the seeding step runs during that app's startup

#### Scenario: An app that does not import the seeding capability boots
- **WHEN** an app that does not import the seeding capability starts (but still uses the shared database connection)
- **THEN** no seeding step runs during that app's startup, and no seeding-related log lines are emitted
