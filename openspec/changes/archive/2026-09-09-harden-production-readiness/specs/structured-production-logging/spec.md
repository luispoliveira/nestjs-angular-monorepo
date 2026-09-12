## Purpose

Ensures production log output is machine-parseable structured JSON suitable for log-aggregation tooling, while development keeps the current human-readable, colorized format.

## ADDED Requirements

### Requirement: Production emits structured JSON logs
When running in production, every NestJS app SHALL emit log lines as structured JSON, with no pretty-printing or colorization applied.

#### Scenario: App boots with NODE_ENV=production
- **WHEN** a NestJS app starts with `NODE_ENV=production`
- **THEN** every log line written to stdout is a single JSON object, parseable by a log-aggregation tool, with no ANSI color codes or human-formatted timestamps

### Requirement: Development keeps human-readable logs
When running outside production, log output SHALL remain pretty-printed and colorized as before this change.

#### Scenario: App boots with NODE_ENV unset or not production
- **WHEN** a NestJS app starts with `NODE_ENV` set to anything other than `production` (or unset)
- **THEN** log lines are rendered pretty-printed and colorized, identical in format to the current development behavior
