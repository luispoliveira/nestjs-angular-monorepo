# Spec Delta

## ADDED Requirements

### Requirement: Sensitive keys in logged bodies are redacted by normalised substring
Before request or response bodies are persisted to the request log, the value of every key whose normalised form (lower-cased, `_` and `-` removed) contains a sensitive term (password, token, secret, api key, authorization, or a protected PII field name) SHALL be replaced by a redaction marker, at any depth. Other keys SHALL be kept.

#### Scenario: Compound key
- **WHEN** a request body containing `clientSecret`, `x_api_key` and `refresh-token` is logged
- **THEN** all three values are stored as the redaction marker

#### Scenario: Nested key
- **WHEN** a request body `{ "user": { "newPassword": "..." } }` is logged
- **THEN** the nested `newPassword` value is stored as the redaction marker

#### Scenario: Ordinary key
- **WHEN** a request body containing `name` and `email` is logged
- **THEN** both values are stored unchanged
