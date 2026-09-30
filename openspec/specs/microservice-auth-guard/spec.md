# microservice-auth-guard Specification

## Purpose

Defines how the HTTP gateway authenticates requests through the auth service, and how it responds when that service rejects the token, is slow, or is unreachable.

## Requirements

### Requirement: Authentication through the auth service fails fast

A protected gateway route SHALL wait at most a fixed, bounded time for the auth service to validate the request's session token. A request SHALL NOT remain pending indefinitely because the auth service does not answer.

#### Scenario: Auth service is down

- **WHEN** an authenticated request reaches a protected `apps/api` route and `apps/auth` is not running
- **THEN** the request completes with a response within the bound
- **AND** the route handler is not executed

#### Scenario: Auth service answers normally

- **WHEN** an authenticated request reaches a protected route and `apps/auth` validates the token within the bound
- **THEN** the route handler runs with the authenticated user attached to the request

### Requirement: Auth unavailability is distinguishable from an invalid session

The gateway SHALL respond 503 Service Unavailable when the auth service does not answer within the bound or cannot be reached, and 401 Unauthorized when the auth service answers that the token is invalid or expired, or when no token is present. A client SHALL be able to tell "sign in again" apart from "try again later" by status code alone.

#### Scenario: Timeout yields 503

- **WHEN** the auth service does not answer within the bound
- **THEN** the response status is 503

#### Scenario: Rejected token yields 401

- **WHEN** the auth service answers with an error for the presented token
- **THEN** the response status is 401

#### Scenario: Missing token yields 401 without calling auth

- **WHEN** a request to a protected route carries neither a bearer token nor a session cookie
- **THEN** the response status is 401
- **AND** no message is sent to the auth service

#### Scenario: Public routes are unaffected

- **WHEN** a request reaches a route marked public while the auth service is down
- **THEN** the route handler runs normally
