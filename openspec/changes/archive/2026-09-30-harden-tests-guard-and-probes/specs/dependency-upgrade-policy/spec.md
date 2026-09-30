# Spec Delta

## ADDED Requirements

### Requirement: The update routine covers every workspace manifest

The dependency-update routine SHALL consider the dependencies declared in the root manifest and in every workspace package manifest (`apps/*`, `packages/*`), and SHALL apply the same acceptance rules to all of them.

#### Scenario: An app dependency has an acceptable upgrade

- **WHEN** the update routine runs and a dependency declared only in an `apps/*` or `packages/*` manifest has a newer acceptable version
- **THEN** that manifest is updated to it

#### Scenario: A blocked dependency declared in a workspace

- **WHEN** the update routine runs and a blocked dependency (for example `@nestjs/core`) is declared in a workspace manifest
- **THEN** that workspace manifest leaves it unchanged
