# Prometheus Metrics

## Purpose

Defines the requirements for exposing a Prometheus-compatible `/metrics` endpoint from every NestJS app in the monorepo. Covers the always-on public endpoint, default Node.js process metrics, per-app labelling, HTTP request duration tracking, and optional bearer-token protection.

---

## Requirements

### Requirement: Metrics endpoint is always-on and public

Every NestJS app that imports `SharedModule` SHALL expose a `GET /metrics` endpoint returning Prometheus text format. The endpoint SHALL be decorated with `@Public()` to bypass `AuthGuard` and SHALL use `VERSION_NEUTRAL` so it is not affected by API versioning. No per-app opt-in is required.

#### Scenario: Metrics endpoint returns valid Prometheus text

- **WHEN** a GET request is made to `/<globalPrefix>/metrics`
- **THEN** the response status is 200 with `Content-Type: text/plain; version=0.0.4; charset=utf-8`

#### Scenario: Metrics endpoint is not logged

- **WHEN** a GET request is made to `/metrics`
- **THEN** no HTTP log entry is written to MongoDB (path is already in `SILENT_PATHS`)

---

### Requirement: Default process metrics are collected

The metrics endpoint SHALL include Node.js runtime defaults provided by `prom-client` `collectDefaultMetrics()`, including event-loop lag, heap usage, and GC statistics.

#### Scenario: Default metrics present in response

- **WHEN** `GET /metrics` is called
- **THEN** the response body contains `process_resident_memory_bytes` and `nodejs_eventloop_lag_seconds`

---

### Requirement: App label is included in all metrics

When `SharedModule.register({ metrics: { appName } })` is called, all metrics SHALL include a `app="<appName>"` default label. When `appName` is not provided, metrics are emitted without the `app` label.

#### Scenario: App label present when configured

- **WHEN** `SharedModule.register({ metrics: { appName: 'auth' } })` is used and `GET /metrics` is called
- **THEN** all metric lines include `app="auth"` in their label set

#### Scenario: Metrics still work without appName

- **WHEN** `SharedModule.register()` is called without a `metrics` option
- **THEN** `GET /metrics` returns a valid response (no `app` label, no errors)

---

### Requirement: HTTP request duration is tracked per route pattern

The `HttpMetricsInterceptor` SHALL record a histogram `http_request_duration_seconds{method, route, status}` and a counter `http_requests_total{method, route, status}` for every HTTP request. The `route` label SHALL use the Express route pattern (e.g., `/users/:id`), never the raw URL. Non-HTTP contexts (Redis microservice) SHALL be skipped.

#### Scenario: Route pattern used as label, not raw URL

- **WHEN** `GET /users/123` is handled by a controller bound to `/users/:id`
- **THEN** the metric label is `route="/users/:id"`, not `route="/users/123"`

#### Scenario: Unknown routes labelled safely

- **WHEN** a request matches no controller route (e.g., 404)
- **THEN** the `route` label is `"[unknown]"`, not the raw request path

#### Scenario: Microservice context is excluded

- **WHEN** a Redis `@MessagePattern` or `@EventPattern` handler is invoked
- **THEN** no `http_request_duration_seconds` sample is recorded for that invocation

---

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
