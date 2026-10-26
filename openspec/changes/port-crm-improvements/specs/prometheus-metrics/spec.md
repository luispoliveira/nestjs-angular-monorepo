# Spec Delta

## MODIFIED Requirements

### Requirement: Optional bearer-token protection for the metrics endpoint
When the `METRICS_TOKEN` environment variable is set, the `MetricsAuthGuard` SHALL enforce `Authorization: Bearer <token>` on the `/metrics` endpoint. Requests with a missing or wrong token SHALL receive a 401 response. When `METRICS_TOKEN` is not set, the endpoint SHALL be open outside production and SHALL refuse every request with 401 in production (`NODE_ENV=production`).

#### Scenario: Token required when METRICS_TOKEN is set
- **WHEN** `METRICS_TOKEN=secret` is set and a request is made to `/metrics` without an Authorization header
- **THEN** the response status is 401

#### Scenario: Token accepted when correct
- **WHEN** `METRICS_TOKEN=secret` is set and a request is made with `Authorization: Bearer secret`
- **THEN** the response status is 200

#### Scenario: Endpoint open when METRICS_TOKEN is unset
- **WHEN** `METRICS_TOKEN` is not in the environment and `NODE_ENV` is not `production`
- **THEN** `GET /metrics` returns 200 without any Authorization header

#### Scenario: Endpoint closed in production when METRICS_TOKEN is unset
- **WHEN** `METRICS_TOKEN` is not in the environment and `NODE_ENV=production`
- **THEN** `GET /metrics` returns 401, with or without an Authorization header
