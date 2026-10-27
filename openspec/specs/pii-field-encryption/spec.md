# pii-field-encryption Specification

## Purpose

Defines how a personal-data field (first used for the customer NIF) is protected at rest and in logs, while still being searchable by exact value and enforceable as unique.

## Requirements

### Requirement: Protected field values are encrypted at rest

A protected field SHALL be persisted only in encrypted form. The plaintext value SHALL NOT be stored in any database column. Encrypting the same value twice SHALL produce different stored ciphertexts. API responses to authorized readers SHALL return the decrypted value.

#### Scenario: Stored value is not plaintext

- **WHEN** a customer is created with a NIF
- **THEN** no column of the stored customer row contains that NIF's digits in plaintext

#### Scenario: Round trip

- **WHEN** a customer created with a NIF is then retrieved through the API
- **THEN** the response's `taxId` equals the normalized NIF

#### Scenario: Non-deterministic ciphertext

- **WHEN** the same NIF is encrypted twice
- **THEN** the two encrypted values differ and both decrypt to the same NIF

### Requirement: Protected values are normalized before indexing

A protected value SHALL be reduced to one canonical form before it is encrypted, indexed or compared. For a Portuguese NIF the canonical form SHALL be its 9 digits, with whitespace and an optional case-insensitive `PT` prefix removed. The browser and the API SHALL apply the identical normalization.

#### Scenario: Equivalent notations

- **WHEN** `"PT 123 456 789"`, `"pt123456789"` and `"123456789"` are normalized
- **THEN** all three produce `"123456789"`

#### Scenario: Shared normalization

- **WHEN** the web form and the API each normalize the same input
- **THEN** both produce the same canonical value

### Requirement: A keyed blind index enables equality search and uniqueness

Each stored protected value SHALL have a deterministic keyed hash of its canonical form. Exact-match search and uniqueness enforcement SHALL use that hash and SHALL NOT decrypt stored values. The hash SHALL NOT be derivable without the server-held key, and it SHALL NOT support partial matching.

#### Scenario: Equality lookup without decryption

- **WHEN** customers are searched by a full valid NIF
- **THEN** the match is found by comparing the keyed hash of the canonical search value

#### Scenario: Different key, different index

- **WHEN** the same NIF is indexed under two different index keys
- **THEN** the two index values differ

### Requirement: Protected plaintext never reaches logs

The plaintext of a protected field SHALL NOT appear in persisted HTTP request/response logs or in application logs. Where such a log would contain the field, the value SHALL be replaced by a redaction marker.

#### Scenario: Request log

- **WHEN** an admin creates a customer with a NIF and the request is logged
- **THEN** the stored request log shows the `taxId` value redacted

#### Scenario: Response log

- **WHEN** a customer response containing `taxId` is logged
- **THEN** the stored response log shows the `taxId` value redacted

#### Scenario: Search term in a logged URL

- **WHEN** customers are searched by NIF (`?search=<nif>`) and the request is logged
- **THEN** every logged URL shows the `search` value redacted, while the path and other query parameters are kept

### Requirement: Encryption keys are required configuration

An app that handles protected fields SHALL require an encryption key (base64, exactly 32 bytes) and a separate index key (base64) at boot. It SHALL refuse to start when either key is missing or when the encryption key has the wrong length. The project setup script SHALL generate both keys for local development.

#### Scenario: Missing key

- **WHEN** the API starts without the encryption key or without the index key
- **THEN** startup fails with an error naming the missing variable

#### Scenario: Wrong key length

- **WHEN** the API starts with an encryption key that does not decode to 32 bytes
- **THEN** startup fails with an error stating the required length

#### Scenario: Local setup

- **WHEN** a developer runs the project setup script on a fresh checkout
- **THEN** the API's local environment file contains generated values for both keys
