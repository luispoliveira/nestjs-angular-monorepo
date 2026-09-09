# Dependency Upgrade Policy Specification

## Purpose

Keeps the workspace's dependency-update routine from adopting versions that are not production-ready or that no peer in the stack accepts, and makes every such block self-explaining so it can be reviewed and lifted rather than quietly outliving its reason. Because this workspace is a template consumed by copy, the guard travels into every derived project along with the routine it protects.

## Requirements

### Requirement: The update routine refuses versions the workspace cannot accept

The dependency-update routine SHALL NOT raise a dependency to a version that the workspace has determined it cannot accept. A version is unacceptable when it is not a stable release, or when any package already in the workspace declares a peer requirement that excludes it. Running the routine SHALL leave such dependencies at their current version without requiring the operator to notice and revert the change.

#### Scenario: A pre-release published under a stable channel

- **WHEN** the update routine runs and a dependency's default published version is a release candidate, beta, or other pre-release
- **THEN** that dependency is left unchanged
- **AND** no manifest records the pre-release version

#### Scenario: A stable release that a peer requirement excludes

- **WHEN** the update routine runs and a dependency's newest stable version falls outside a peer requirement declared by another package in the workspace
- **THEN** that dependency is left unchanged

#### Scenario: An acceptable upgrade is not obstructed

- **WHEN** the update routine runs and a dependency has a newer stable version that every declared peer requirement admits
- **THEN** that dependency is raised to it

#### Scenario: The routine is safe to run unattended

- **WHEN** an operator runs the update routine and applies its result without individually reviewing each version
- **THEN** the workspace still builds, type-checks, and passes its tests

### Requirement: Every block states its cause and its release condition

Each blocked dependency SHALL record the specific reason it is blocked and the condition under which the block can be lifted. A block SHALL NOT be recorded as a bare version pin with no stated cause.

#### Scenario: Reading why a dependency is held back

- **WHEN** someone inspects the blocked dependencies
- **THEN** each one names what prevents its adoption
- **AND** each one names the observable condition that would make it adoptable

#### Scenario: Re-evaluating a block

- **WHEN** the stated condition for a blocked dependency is met
- **THEN** the block can be lifted without re-deriving the original analysis

### Requirement: Deferred upgrades are recorded for future maintainers

Upgrades that the workspace has deliberately declined SHALL be recorded in the project's accumulated-gotchas log, so a later maintainer does not repeat the investigation or reverse the decision unknowingly.

#### Scenario: A maintainer encounters a deferred upgrade

- **WHEN** a maintainer considers adopting a version the workspace previously declined
- **THEN** the log explains why it was declined and what would need to change

### Requirement: The guard reaches projects derived from this template

Because this workspace is distributed as a template, the guard SHALL be part of what a derived project receives, so that a project created from the template inherits the protection without any additional setup.

#### Scenario: A new project runs the update routine

- **WHEN** a project created from this template runs the inherited update routine
- **THEN** the same dependencies are blocked as in the template
- **AND** the reasons are available in the derived project
