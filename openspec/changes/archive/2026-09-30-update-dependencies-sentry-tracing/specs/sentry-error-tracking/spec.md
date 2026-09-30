## MODIFIED Requirements

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

## ADDED Requirements

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
