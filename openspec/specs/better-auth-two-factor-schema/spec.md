# Better Auth Two-Factor Schema Specification

## Purpose

Defines what the persisted two-factor authentication record must carry so that better-auth's own schema validation succeeds and two-factor requests are not rejected. Unlike the withdrawn account-identity investigation elsewhere in this change, this capability corresponds to a genuinely necessary, currently-applied schema change.

## Requirements

### Requirement: The persisted two-factor record carries every field the plugin expects

A stored two-factor record SHALL carry every field the two-factor plugin declares, whether or not that field is required, so that the authentication library's own schema validation finds no mismatch.

#### Scenario: Schema validation passes at startup

- **WHEN** the application using the two-factor plugin starts and its schema is validated against the persisted model
- **THEN** no missing-column mismatch is reported for the two-factor record

#### Scenario: A two-factor record is created

- **WHEN** a user enrolls in two-factor authentication
- **THEN** the stored record can hold a verification state, a failed-attempt count, and a lockout expiry, even when the request that created it did not set them

### Requirement: Two-factor requests are not rejected by a schema mismatch

Because the authentication library rejects requests when it detects a schema mismatch, the persisted model SHALL NOT be missing a field the two-factor plugin expects to read or write.

#### Scenario: Sign-up succeeds with two-factor enabled

- **WHEN** a user signs up in an application that has the two-factor plugin registered
- **THEN** the request completes without a schema-mismatch error

#### Scenario: Sign-in succeeds with two-factor enabled

- **WHEN** a user signs in in an application that has the two-factor plugin registered
- **THEN** the request completes without a schema-mismatch error

### Requirement: The schema change is additive and safe for existing data

Because a project derived from this template may already hold two-factor records, closing this gap SHALL NOT require rewriting or discarding any existing row.

#### Scenario: Applying the fix to a project with existing two-factor records

- **WHEN** a derived project with existing two-factor records applies this schema correction
- **THEN** every existing record remains readable
- **AND** no record is required to have its new fields populated before the correction can be applied
