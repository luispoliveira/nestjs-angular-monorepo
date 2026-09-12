## Purpose

Enforces role-based access control server-side on backend routes, so that a non-admin authenticated user cannot reach an admin-only endpoint simply by calling the API directly, bypassing the frontend's role check.

## ADDED Requirements

### Requirement: Role-restricted routes reject insufficient roles
A route marked as requiring a specific role SHALL reject an authenticated request whose user does not hold that role.

#### Scenario: Non-admin user calls an admin-only route
- **WHEN** an authenticated user without the `admin` role calls a route restricted to `admin`
- **THEN** the request is rejected with a 403 Forbidden response and no handler logic runs

#### Scenario: Admin user calls an admin-only route
- **WHEN** an authenticated user with the `admin` role calls a route restricted to `admin`
- **THEN** the request proceeds to the route handler

### Requirement: Routes without a role restriction are unaffected
A route that does not declare a role restriction SHALL behave exactly as it did before this capability existed — any authenticated user may reach it.

#### Scenario: Route has no role restriction declared
- **WHEN** an authenticated user of any role calls a route that does not declare a required role
- **THEN** the request proceeds to the route handler, unaffected by this capability

### Requirement: Role check runs after authentication
The role check SHALL only apply to requests that already passed authentication; it SHALL NOT run for unauthenticated requests or for routes marked public.

#### Scenario: Unauthenticated request to a role-restricted route
- **WHEN** an unauthenticated request calls a route restricted to `admin`
- **THEN** the request is rejected by the existing authentication check before any role check occurs
