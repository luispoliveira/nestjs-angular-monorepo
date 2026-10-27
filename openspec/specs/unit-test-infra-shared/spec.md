# unit-test-infra-shared Specification

## Purpose

Ensures packages/shared has a working Jest setup and unit tests for its global NestJS infrastructure: filters, guards, interceptors and producers.

## Requirements

### Requirement: packages/shared has a working Jest configuration

`packages/shared` SHALL have a `jest` block in `package.json` with `ts-jest` transform, 80% coverage thresholds, and `test` / `test:cov` scripts such that `pnpm test` runs successfully with no external services.

#### Scenario: pnpm test runs in packages/shared
- **WHEN** `pnpm test` is run inside `packages/shared`
- **THEN** Jest finds and executes all `*.spec.ts` files under `src/`

#### Scenario: pnpm test:cov passes 80% threshold
- **WHEN** `pnpm test:cov` is run inside `packages/shared`
- **THEN** statements, branches, functions, and lines are all ≥80%

---

### Requirement: AllExceptionFilter is unit tested

`AllExceptionFilter` SHALL have unit tests covering HTTP exceptions, ZodValidationException, RPC context, and 5xx Sentry capture.

#### Scenario: Returns structured JSON for HttpException
- **WHEN** `AllExceptionFilter.catch()` is called with an `HttpException` in HTTP context
- **THEN** `response.status().json()` is called with `statusCode`, `timestamp`, `path`, `message`, and `correlationId`

#### Scenario: Returns 400 with validation errors for ZodValidationException
- **WHEN** `AllExceptionFilter.catch()` is called with a `ZodValidationException`
- **THEN** `response.status(400).json()` is called with `statusCode: 400`, `message: "Validation failed"`, and `errors` array

#### Scenario: Returns 500 for unknown errors
- **WHEN** `AllExceptionFilter.catch()` is called with a plain `Error`
- **THEN** `response.status(500).json()` is called with `statusCode: 500`

#### Scenario: Re-throws exception in RPC context
- **WHEN** `AllExceptionFilter.catch()` is called and `host.getType()` returns `'rpc'`
- **THEN** the original exception is re-thrown (not swallowed)

#### Scenario: Calls Sentry.captureException for 5xx errors
- **WHEN** `AllExceptionFilter.catch()` is called with an exception that results in status ≥500
- **THEN** `Sentry.captureException` is called with the exception

---

### Requirement: MicroserviceAuthGuard is unit tested

`MicroserviceAuthGuard` SHALL have unit tests covering public routes, missing token, successful auth, and auth failure.

#### Scenario: Allows access to public routes
- **WHEN** `canActivate()` is called on a route decorated with `@Public()`
- **THEN** it returns `true` without calling the auth client

#### Scenario: Throws UnauthorizedException when no token is present
- **WHEN** `canActivate()` is called with a request that has no Bearer token or cookie
- **THEN** `UnauthorizedException` is thrown with "No authentication token provided"

#### Scenario: Returns true and sets request.user on valid token
- **WHEN** `canActivate()` is called with a valid Bearer token and the auth client returns a user
- **THEN** the returned Observable emits `true` and `request.user` is set to the returned user

#### Scenario: Returns UnauthorizedException when auth client errors
- **WHEN** `canActivate()` is called and the auth microservice returns an RPC error
- **THEN** the returned Observable errors with `UnauthorizedException("Invalid or expired session")`

---

### Requirement: CorrelationInterceptor is unit tested

`CorrelationInterceptor` SHALL have unit tests covering RPC and HTTP context handling.

#### Scenario: Sets correlationId from RPC payload
- **WHEN** `intercept()` is called in RPC context with a payload containing `correlationId`
- **THEN** `clsService.set` is called with `CLS_CORRELATION_ID` and the correlationId value

#### Scenario: Does not set correlationId in HTTP context
- **WHEN** `intercept()` is called in HTTP context
- **THEN** `clsService.set` is NOT called

#### Scenario: Does not set correlationId when RPC payload has none
- **WHEN** `intercept()` is called in RPC context with a payload that has no correlationId
- **THEN** `clsService.set` is NOT called

---

### Requirement: BaseProducer is unit tested

`BaseProducer` SHALL have unit tests covering job addition with correlationId threading.

#### Scenario: addJob enqueues with correlationId from CLS
- **WHEN** `addJob()` is called and CLS has a correlationId set
- **THEN** `queue.add` is called with the job name and data merged with the correlationId

#### Scenario: addJob enqueues without correlationId when CLS is empty
- **WHEN** `addJob()` is called and CLS returns undefined for correlationId
- **THEN** `queue.add` is called with the job name and data (correlationId is undefined/absent)

---

### Requirement: LoggingInterceptor is unit tested

`LoggingInterceptor` SHALL have unit tests covering request log creation and response/error log updates.

#### Scenario: Creates a log entry on request
- **WHEN** `intercept()` is called with an HTTP request
- **THEN** `mongoService.createLog` is called with method, url, ip, and correlationId

#### Scenario: Updates the log entry with status and duration on success
- **WHEN** the response stream completes successfully
- **THEN** `mongoService.updateLog` is called with the log id, statusCode, duration, and responseBody

#### Scenario: Updates the log entry with error status on failure
- **WHEN** the response stream errors
- **THEN** `mongoService.updateLog` is called with the error statusCode and duration

---

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
