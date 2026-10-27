# dlq-observability Specification

## Purpose

Makes dead-letter queue accumulation visible through queue-depth metrics and an operator alert, without losing the existing per-failure Sentry and Prometheus signals.

## Requirements

### Requirement: QueueMetricsService tracks DLQ queue depth
`apps/worker/src/metrics/queue-metrics.service.ts` SHALL extend the existing `bullmq_queue_depth` Gauge to include `email-queue-dlq` in the `waiting` state alongside the main queue states. No new Gauge is needed — the existing label dimensions (`queue`, `state`) accommodate the DLQ.

#### Scenario: DLQ depth is visible in Prometheus metrics
- **WHEN** the `/metrics` endpoint is scraped
- **THEN** `bullmq_queue_depth{queue="email-queue-dlq", state="waiting"}` is present with the current DLQ job count

#### Scenario: DLQ depth is zero when no failed jobs exist
- **WHEN** the DLQ queue is empty
- **THEN** `bullmq_queue_depth{queue="email-queue-dlq", state="waiting"}` equals `0`

### Requirement: Prometheus alert fires when DLQ is non-empty for over 5 minutes
A Prometheus alert rule SHALL be defined (in the project's alerting config or documented for operators) that fires when `bullmq_queue_depth{queue=~".*-dlq", state="waiting"} > 0` persists for more than 5 minutes. The alert MUST use a wildcard queue label so it covers all future DLQ queues without modification.

#### Scenario: Alert fires on sustained DLQ accumulation
- **WHEN** one or more jobs have been in a DLQ queue for longer than 5 minutes
- **THEN** the alert `BullMQDLQNonEmpty` transitions to `firing` state

#### Scenario: Alert resolves when DLQ is drained
- **WHEN** all DLQ jobs are replayed or purged
- **THEN** the alert `BullMQDLQNonEmpty` transitions to `resolved` state

### Requirement: Existing Sentry failure capture is preserved
The existing `@OnWorkerEvent('failed')` handler in `EmailConsumer` SHALL continue to call `SentryUtil.captureException` and `queueMetrics.recordFailure`. The DLQ routing is additive — it does not replace or suppress the existing failure events.

#### Scenario: Sentry receives exception on job failure before DLQ routing
- **WHEN** a job on `email-queue` fails its final retry
- **THEN** `SentryUtil.captureException` is called with job context
- **THEN** `bullmq_job_failures_total` counter is incremented
- **THEN** the job is also moved to `email-queue-dlq` (both happen independently)
