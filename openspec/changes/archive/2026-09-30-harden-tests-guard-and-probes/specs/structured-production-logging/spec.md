# Spec Delta

## ADDED Requirements

### Requirement: Probe and scrape requests are kept out of request logs

Requests whose path contains `/health`, `/metrics` or `/favicon.ico` as a whole path segment sequence — regardless of any global prefix before it or query string after it — SHALL NOT produce an automatic HTTP request log line on stdout and SHALL NOT be written to the MongoDB request log. Every other request SHALL continue to be logged in both. This applies to every NestJS app.

#### Scenario: Prefixed liveness probe

- **WHEN** a probe requests `/api/health/live` or `/api/health/ready`
- **THEN** no automatic HTTP log line is written to stdout for it
- **AND** no request log document is created in MongoDB for it

#### Scenario: Metrics scrape with a query string

- **WHEN** a scraper requests `/api/metrics?x=1`
- **THEN** it is not logged to stdout or MongoDB

#### Scenario: Look-alike path is still logged

- **WHEN** a client requests `/api/healthcheck` or `/api/users/metrics-report`
- **THEN** the request is logged to stdout and MongoDB as usual

#### Scenario: Ordinary request is still logged

- **WHEN** a client requests `/api/users`
- **THEN** the request is logged to stdout and MongoDB as usual
