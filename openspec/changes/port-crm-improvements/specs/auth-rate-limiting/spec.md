# Spec Delta

## Purpose

Throttles better-auth's own `/api/auth/*` endpoints, which the Nest throttler never reaches, so credential endpoints cannot be brute-forced and the limit holds across every auth worker.

## ADDED Requirements

### Requirement: Credential endpoints are rate-limited per client
The auth service SHALL limit requests per client on its credential endpoints within a 60-second window: email sign-in 10, email sign-up 5, TOTP and backup-code verification 10 each, password-reset request 3, password reset 5. Every other `/api/auth/*` path SHALL be limited to 100 requests per 60 seconds. A request over the limit SHALL be answered with 429 and a `X-Retry-After` header.

#### Scenario: Eleventh sign-in within a minute
- **WHEN** a client sends 11 email sign-in requests within 60 seconds
- **THEN** the 11th is answered with 429
- **AND** the response carries a `X-Retry-After` header with the seconds left in the window

#### Scenario: Requests within the limit
- **WHEN** a client sends 10 email sign-in requests within 60 seconds
- **THEN** none of them is refused by the rate limiter

#### Scenario: Window expiry
- **WHEN** a client was refused and the window has elapsed
- **THEN** its next sign-in request is processed normally

### Requirement: The limit is shared across auth instances
Rate-limit counters SHALL be stored in the shared Redis, so that a client's requests count against one limit regardless of which auth worker or instance serves them.

#### Scenario: Requests spread over two workers
- **WHEN** a client's sign-in requests are served alternately by two auth workers
- **THEN** all of them count against the same limit

### Requirement: Rate limiting fails open when Redis is unavailable
When the rate-limit counter store cannot be reached, the auth service SHALL allow the request instead of refusing it, so a Redis outage does not take down sign-in.

#### Scenario: Redis down during sign-in
- **WHEN** Redis is unreachable and a client signs in
- **THEN** the sign-in is processed as if no limit applied

### Requirement: Rate limiting is disabled in the test environment
The auth rate limiter SHALL be active in every environment except `NODE_ENV=test`, including development.

#### Scenario: Development environment
- **WHEN** the auth service runs with `NODE_ENV=development` and a client exceeds the sign-in limit
- **THEN** the excess request is answered with 429

#### Scenario: Test environment
- **WHEN** the auth service runs with `NODE_ENV=test` and a suite sends more sign-ins than the limit
- **THEN** none of them is refused by the rate limiter
