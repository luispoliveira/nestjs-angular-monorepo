# dead-letter-queue Specification

## Purpose

Keeps BullMQ jobs that exhaust their retries in a companion dead-letter queue instead of losing them, so they can be inspected, replayed or purged later.

## Requirements

### Requirement: DLQ queue constants and naming convention
The system SHALL define a DLQ companion constant for every BullMQ queue constant in `packages/shared/src/constants/queues.ts`, following the naming pattern `<queue-name>-dlq`. The `EMAIL_DLQ` constant SHALL be `'email-queue-dlq'`.

#### Scenario: DLQ constant is available to all consumers
- **WHEN** a module imports `QUEUES` from `@repo/shared`
- **THEN** `QUEUES.EMAIL_DLQ` resolves to `'email-queue-dlq'`

### Requirement: QueueModule auto-registers DLQ companion queues
When `QueueModule.registerQueues([QUEUES.EMAIL])` is called, the module SHALL internally register both `email-queue` and `email-queue-dlq` without requiring the caller to explicitly enumerate the DLQ queue name.

#### Scenario: Companion DLQ queue is available after registerQueues
- **WHEN** a module calls `QueueModule.registerQueues([QUEUES.EMAIL])`
- **THEN** both `email-queue` and `email-queue-dlq` BullMQ queues are registered and injectable

#### Scenario: DLQ queue uses capped retention defaults
- **WHEN** a job is added to `email-queue-dlq`
- **THEN** the job's default options include `removeOnFail: { count: 1000, age: 2592000 }` (30 days)

### Requirement: EmailConsumer routes permanently failed jobs to the DLQ
When a job on `email-queue` fails and its `attemptsMade` has reached its configured `attempts`, the `EmailConsumer` `@OnWorkerEvent('failed')` handler SHALL add a copy of the job (same name and data) to `email-queue-dlq`. A failure that still has retries left SHALL NOT be routed to the DLQ.

#### Scenario: Job moved to DLQ after exhausting retries
- **WHEN** a job on `email-queue` fails on its final retry attempt (attempt 3)
- **THEN** the job is placed into `email-queue-dlq` in `waiting` state
- **THEN** the existing `@OnWorkerEvent('failed')` hook still fires (Sentry + Prometheus)

#### Scenario: Failure with retries left is not routed
- **WHEN** a job on `email-queue` fails on a non-final attempt
- **THEN** no job is added to `email-queue-dlq`

#### Scenario: DLQ queue has no processor
- **WHEN** a job arrives in `email-queue-dlq`
- **THEN** no Worker processes it automatically
- **THEN** the job remains in `waiting` state until explicitly replayed or purged

### Requirement: BaseDlqService provides generic DLQ operations
`packages/shared/src/abstracts/base.dlq.service.ts` SHALL be an abstract class that accepts an injected DLQ queue and an original queue, and provides the following operations: `list`, `replay`, `replayAll`, `purge`, and `count`.

#### Scenario: list returns paginated DLQ jobs
- **WHEN** `BaseDlqService.list(page, limit)` is called
- **THEN** it returns the jobs currently in the DLQ queue with their id, name, data, failedReason, and timestamp

#### Scenario: replay re-enqueues a job and removes it from the DLQ
- **WHEN** `BaseDlqService.replay(jobId)` is called with a valid DLQ job id
- **THEN** a fresh job with the same name and data is added to the original queue
- **THEN** the DLQ entry is removed
- **WHEN** `BaseDlqService.replay(jobId)` is called with an unknown job id
- **THEN** a `NotFoundException` is thrown

#### Scenario: purge removes all jobs from the DLQ
- **WHEN** `BaseDlqService.purge()` is called
- **THEN** all jobs in the DLQ queue are removed

#### Scenario: count returns the current DLQ depth
- **WHEN** `BaseDlqService.count()` is called
- **THEN** it returns the number of jobs currently in `waiting` state on the DLQ queue
