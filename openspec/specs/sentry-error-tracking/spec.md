# Sentry Error Tracking

## Purpose

Defines how backend applications initialise and use Sentry for error tracking, including which exceptions are captured, how they are tagged per-service, and how Bull job failures are reported.

---

## Requirements

### Requirement: Sentry initialises before the NestJS application starts
Each backend app (`api`, `auth`, `notifications`, `worker`, `cron`) SHALL initialise Sentry before any other module of the application or its dependencies is loaded, so that automatic instrumentation can hook every module as it loads. Initialisation SHALL see the same environment the app itself will run with, including values that are only defined in the app's `.env` file, without letting that file override variables already set in the process environment.

#### Scenario: DSN present in environment
- **WHEN** `SENTRY_DSN` is set in the environment and the `auth` app starts
- **THEN** Sentry initialises with the provided DSN, `environment` set from `NODE_ENV`, `tracesSampleRate` taken from `SENTRY_TRACES_SAMPLE_RATE`, and an `app` tag equal to `'auth'`

#### Scenario: DSN defined only in the app's .env file
- **WHEN** `SENTRY_DSN` is absent from the process environment but defined in the `.env` file in the app's working directory, and the app starts
- **THEN** Sentry initialises with the DSN from that file

#### Scenario: Process environment wins over .env
- **WHEN** `SENTRY_DSN` is set both in the process environment and in the `.env` file with different values
- **THEN** Sentry initialises with the process-environment value

#### Scenario: No .env file present
- **WHEN** the app starts in a working directory with no `.env` file (e.g. a container with env injected)
- **THEN** startup proceeds without error and Sentry reads only the process environment

#### Scenario: DSN absent from environment
- **WHEN** `SENTRY_DSN` is set neither in the process environment nor in `.env`
- **THEN** Sentry is not initialised, no error is thrown, and the app starts normally

#### Scenario: Traces sample rate not set
- **WHEN** `SENTRY_DSN` is set and `SENTRY_TRACES_SAMPLE_RATE` is not
- **THEN** Sentry initialises with a `tracesSampleRate` of `0`, so no traces are sent

---

### Requirement: HTTP 5xx errors are captured to Sentry
`AllExceptionFilter` SHALL call `Sentry.captureException()` for any HTTP exception whose response status is 500 or above.

#### Scenario: Unhandled server error on HTTP request
- **WHEN** an unhandled exception reaches `AllExceptionFilter` in an HTTP context and the resolved status is >= 500
- **THEN** the exception is forwarded to Sentry before the JSON error response is sent to the client

#### Scenario: Client error on HTTP request
- **WHEN** an `HttpException` with status < 500 (e.g., 400, 404) reaches `AllExceptionFilter`
- **THEN** the exception is NOT sent to Sentry and the filter responds normally

#### Scenario: Zod validation error on HTTP request
- **WHEN** a `ZodValidationException` reaches `AllExceptionFilter`
- **THEN** the exception is NOT sent to Sentry and the filter returns a 400 response with validation details

---

### Requirement: RPC microservice exceptions are captured to Sentry
`AllExceptionFilter` SHALL handle the RPC execution context without crashing and SHALL capture all RPC-context exceptions to Sentry.

#### Scenario: Exception in a @MessagePattern handler
- **WHEN** an exception is thrown inside a `@MessagePattern` handler in `auth` or `notifications`
- **THEN** `AllExceptionFilter` catches it in RPC context, captures it to Sentry, logs the error, and rethrows so NestJS can serialise the error response to the caller

#### Scenario: Exception in an @EventPattern handler
- **WHEN** an exception is thrown inside an `@EventPattern` handler
- **THEN** `AllExceptionFilter` catches it in RPC context, captures it to Sentry, and rethrows

---

### Requirement: Bull job failures are captured to Sentry
The `worker` app's `EmailConsumer` SHALL capture Bull job failures to Sentry with job metadata as extra context.

#### Scenario: Email job fails after exhausting retries
- **WHEN** a Bull job in the email queue fails (on any attempt)
- **THEN** `Sentry.captureException()` is called with the error, the job ID, job name, and sanitised job data as extra context, and the `app: 'worker'` tag is included

---

### Requirement: Per-app tagging in Sentry
Every exception captured from a backend app SHALL include an `app` tag identifying the originating service.

#### Scenario: Error captured from the auth app
- **WHEN** an error is captured to Sentry while `SentryUtil.init('auth')` was called at startup
- **THEN** the Sentry event has `tags.app === 'auth'`

#### Scenario: Error captured from the worker app
- **WHEN** an error is captured to Sentry while `SentryUtil.init('worker')` was called at startup
- **THEN** the Sentry event has `tags.app === 'worker'`

---

### Requirement: Sampled requests are traced automatically
When tracing is enabled (`SENTRY_DSN` set and `SENTRY_TRACES_SAMPLE_RATE` greater than `0`), each backend app SHALL send transactions for sampled incoming HTTP requests without any per-handler code, named after the matched route, and containing child spans for the outgoing work the request performs through automatically-instrumented libraries (at minimum: outgoing HTTP calls and PostgreSQL queries).

#### Scenario: Sampled HTTP request
- **WHEN** tracing is enabled with `SENTRY_TRACES_SAMPLE_RATE=1` and the `api` app serves `GET /api/v1/users`
- **THEN** Sentry receives a transaction for that request, named after the route template (not the raw URL with IDs), tagged `app: 'api'`

#### Scenario: Database work inside a traced request
- **WHEN** a sampled request handler queries PostgreSQL through the shared database client
- **THEN** the transaction contains a database span for that query

#### Scenario: Tracing disabled
- **WHEN** `SENTRY_TRACES_SAMPLE_RATE` is `0` or unset
- **THEN** no transactions are sent, and error capture behaves exactly as when tracing is enabled

#### Scenario: Health and metrics probes
- **WHEN** tracing is enabled and a probe hits `/health/live`, `/health/ready` or `/metrics`
- **THEN** no transaction is sent for that request
