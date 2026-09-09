## Purpose

Defines how a linked authentication account is identified in persistent storage, so that the stored model matches the identity scheme the authentication library uses to look accounts up. It also defines what a project derived from this template must do to move existing account rows onto that scheme without losing or merging identities.

## ADDED Requirements

### Requirement: An account is identified by its issuer together with its provider account identifier

A stored authentication account SHALL carry an issuer identifying the authority that vouches for it, alongside the account identifier assigned by that authority. The combination SHALL be required on every account, and no two accounts SHALL share the same combination.

#### Scenario: An account is persisted

- **WHEN** an authentication account is stored
- **THEN** it carries both an issuer and a provider account identifier
- **AND** neither is empty

#### Scenario: A duplicate identity is rejected

- **WHEN** an attempt is made to store an account whose issuer and provider account identifier both match an existing account
- **THEN** the write is rejected

#### Scenario: The same identifier under two different issuers

- **WHEN** two accounts share a provider account identifier but carry different issuers
- **THEN** both are stored
- **AND** they resolve to their own users independently

### Requirement: Account lookup resolves exactly one account

Looking an account up by its issuer and provider account identifier SHALL yield at most one account. The stored model SHALL make an ambiguous match impossible rather than resolving it at read time.

#### Scenario: Sign-in resolves an account

- **WHEN** a user signs in through a provider
- **THEN** exactly one stored account matches the presented identity
- **AND** the user linked to it is the one authenticated

#### Scenario: No account matches

- **WHEN** no stored account matches the presented identity
- **THEN** authentication does not succeed against an unrelated account

### Requirement: Password-based accounts carry a distinct local issuer

An account authenticated by a password held in this system SHALL carry an issuer that marks it as local rather than delegated, so that it can never collide with an account vouched for by an external authority.

#### Scenario: A password account is stored

- **WHEN** a user registers with an email address and password
- **THEN** the resulting account's issuer marks it as locally issued
- **AND** it is distinguishable from an account issued by an external provider

#### Scenario: A local account and an external account for one user

- **WHEN** a user has both a password account and an account from an external provider
- **THEN** the two accounts carry different issuers
- **AND** both remain linked to that user

### Requirement: A derived project has a defined path to migrate existing accounts

Because this workspace is distributed as a template consumed by copy, a project already holding account data SHALL have a defined procedure to move that data onto the identity scheme. The procedure SHALL let the project detect, before applying the change, whether its data would violate the uniqueness the scheme requires.

#### Scenario: Detecting a conflict before migrating

- **WHEN** a derived project checks its existing account data against the identity scheme
- **THEN** any set of rows that would collide under the new uniqueness is reported
- **AND** it is reported before the constraint is applied

#### Scenario: Migrating without a conflict

- **WHEN** a derived project with no colliding rows follows the procedure
- **THEN** every existing account ends up with an issuer
- **AND** each account still resolves to the user it resolved to beforehand

#### Scenario: Existing users keep their sign-in

- **WHEN** a user who could sign in before the migration signs in afterwards with the same credentials
- **THEN** authentication succeeds
- **AND** resolves to the same user

#### Scenario: A new project needs no migration

- **WHEN** a project is created fresh from the template
- **THEN** its initial schema already carries the identity scheme
- **AND** no backfill step is required
