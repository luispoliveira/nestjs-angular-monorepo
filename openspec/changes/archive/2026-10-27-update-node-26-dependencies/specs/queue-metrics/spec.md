# Spec Delta

## MODIFIED Requirements

### Requirement: Queue depth is tracked per job state as a gauge

The worker app SHALL expose a Gauge `bullmq_queue_depth{queue, state}` reporting the count of jobs per queue per state (`waiting`, `active`, `delayed`, `failed`). The gauge SHALL be collected lazily at scrape time using `@prometheus-io/client`'s `collect()` callback; no interval timer SHALL be used.

#### Scenario: Queue depth collected at scrape time

- **WHEN** `GET /metrics` is scraped and the email queue has 3 waiting jobs
- **THEN** the response contains `bullmq_queue_depth{queue="email-queue",state="waiting"} 3`

#### Scenario: No polling timer is created

- **WHEN** the worker app starts
- **THEN** no `setInterval` or `setTimeout` is registered to update queue depth metrics
