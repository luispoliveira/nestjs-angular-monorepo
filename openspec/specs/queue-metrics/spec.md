# Queue Metrics

## Purpose

Defines the requirements for tracking BullMQ queue and job metrics via Prometheus in the worker app. Covers lazy queue-depth gauges per state, per-job-type duration histograms, and failed-job counters.

---

## Requirements

### Requirement: Queue depth is tracked per job state as a gauge

The worker app SHALL expose a Gauge `bullmq_queue_depth{queue, state}` reporting the count of jobs per queue per state (`waiting`, `active`, `delayed`, `failed`). The gauge SHALL be collected lazily at scrape time using `@prometheus-io/client`'s `collect()` callback; no interval timer SHALL be used.

#### Scenario: Queue depth collected at scrape time

- **WHEN** `GET /metrics` is scraped and the email queue has 3 waiting jobs
- **THEN** the response contains `bullmq_queue_depth{queue="email-queue",state="waiting"} 3`

#### Scenario: No polling timer is created

- **WHEN** the worker app starts
- **THEN** no `setInterval` or `setTimeout` is registered to update queue depth metrics

---

### Requirement: Job duration is recorded per job type

The worker app SHALL record a histogram `bullmq_job_duration_seconds{queue, job_name}` on each job completion, using `job.finishedOn - job.processedOn` as the observed value. The `job_name` label SHALL use values from `JOB_PATTERNS`.

#### Scenario: Duration recorded on job completion

- **WHEN** a `SEND_WELCOME_EMAIL` job completes in 450ms
- **THEN** a sample is recorded: `bullmq_job_duration_seconds{queue="email-queue",job_name="send-welcome-email",le=...}`

---

### Requirement: Failed job counter is incremented per job type

The worker app SHALL maintain a counter `bullmq_job_failures_total{queue, job_name}` that is incremented each time a job exhausts all retry attempts. This counter complements the existing Sentry capture in `EmailConsumer`.

#### Scenario: Counter incremented on final failure

- **WHEN** a job fails with `attemptsMade` equal to `opts.attempts`
- **THEN** `bullmq_job_failures_total{queue="email-queue",job_name="send-welcome-email"}` increases by 1
