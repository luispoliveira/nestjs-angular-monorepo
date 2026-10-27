# Spec Delta

## MODIFIED Requirements

### Requirement: HttpMetricsInterceptor is unit tested

`HttpMetricsInterceptor` SHALL have unit tests covering metric recording for HTTP requests, with `@prometheus-io/client` mocked.

#### Scenario: Records duration and increments counter on success
- **WHEN** `intercept()` is called for an HTTP request that completes successfully
- **THEN** `@prometheus-io/client` histogram `observe` and counter `inc` are called with method, route, and status labels

#### Scenario: Records duration and increments counter on error
- **WHEN** `intercept()` is called for an HTTP request that throws
- **THEN** `@prometheus-io/client` histogram `observe` and counter `inc` are still called

#### Scenario: Passes through non-HTTP context unchanged
- **WHEN** `intercept()` is called in RPC context
- **THEN** `@prometheus-io/client` metrics are NOT called
