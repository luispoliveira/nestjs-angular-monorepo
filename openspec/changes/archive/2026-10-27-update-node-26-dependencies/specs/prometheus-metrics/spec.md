# Spec Delta

## MODIFIED Requirements

### Requirement: Default process metrics are collected

The metrics endpoint SHALL include Node.js runtime defaults provided by `@prometheus-io/client` `collectDefaultMetrics()` (the maintained successor of the deprecated `prom-client`), including event-loop lag, heap usage, and GC statistics. Default and custom metrics SHALL be served from the same registry, so `/metrics` exposes both.

#### Scenario: Default metrics present in response

- **WHEN** `GET /metrics` is called
- **THEN** the response body contains `process_resident_memory_bytes` and `nodejs_eventloop_lag_seconds`

#### Scenario: Custom metrics share the registry with default metrics

- **WHEN** an HTTP request has been handled and `GET /metrics` is called
- **THEN** the response body contains both `process_resident_memory_bytes` and `http_requests_total`
