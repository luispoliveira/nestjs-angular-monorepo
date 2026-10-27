# Node Runtime Specification

## Purpose

Keeps the workspace on a single supported Node.js major line, declared identically wherever a Node version is chosen (local tooling, CI, package engines, container images), so that what is developed, tested and shipped runs on the same runtime.

## Requirements

### Requirement: The workspace targets one Node major line

The workspace SHALL target Node.js 26. The pinned version used by local tooling and CI, the minimum accepted by the root package engines, and the base image of every container build SHALL all belong to that same major line.

#### Scenario: CI runs on the pinned version

- **WHEN** the CI workflow sets up Node
- **THEN** it uses the version pinned in the repository's Node version file, which is a 26.x release

#### Scenario: Container images use the same major

- **WHEN** any app's container image is built
- **THEN** every build stage's Node base image is of major version 26

#### Scenario: Engines admit the target line

- **WHEN** the workspace is installed on Node 26.x
- **THEN** the root package engines accept that version

### Requirement: Unsupported Node versions are refused by the engines declaration

The root package engines SHALL NOT admit any Node version older than the target major line.

#### Scenario: An older line is not admitted

- **WHEN** the root engines range is evaluated against Node 24.22.1 or 22.23.4
- **THEN** neither version satisfies it

### Requirement: Drift between Node declarations is detected

The workspace SHALL provide an automated check that fails when the Node major declared in the version file, the root engines and any container image disagree.

#### Scenario: All declarations agree

- **WHEN** the check runs and the version file, engines minimum and all container base images share one major
- **THEN** the check passes

#### Scenario: A container image lags behind

- **WHEN** the check runs and one Dockerfile still uses a Node base image of a different major
- **THEN** the check fails and names that Dockerfile
