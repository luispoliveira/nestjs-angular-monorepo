# Spec Delta

## MODIFIED Requirements

### Requirement: Worker app exposes DLQ message pattern handlers
`apps/worker/src/dlq/dlq.controller.ts` SHALL implement `@MessagePattern` handlers for `DLQ_LIST`, `DLQ_REPLAY`, and `DLQ_PURGE`. Each handler SHALL delegate to the DLQ service of the queue named in the payload (`email-queue` or `push-queue`) and return a serialisable result over the Redis microservice transport. A payload naming any other queue SHALL return an error response.

#### Scenario: DLQ_LIST returns current DLQ job list
- **WHEN** `DLQ_LIST` is received with `{ queue: 'email-queue', page: number, limit: number }`
- **THEN** the handler returns `{ jobs: DlqJobDto[], total: number }`

#### Scenario: DLQ_LIST for the push queue
- **WHEN** `DLQ_LIST` is received with `{ queue: 'push-queue', page: number, limit: number }`
- **THEN** the handler returns the jobs of `push-queue-dlq` as `{ jobs: DlqJobDto[], total: number }`

#### Scenario: DLQ_REPLAY replays a specific job
- **WHEN** `DLQ_REPLAY` is received with `{ queue: 'email-queue', jobId: string }`
- **THEN** the handler calls `EmailDlqService.replay(jobId)` and returns `{ success: true }`
- **WHEN** the job id does not exist in the DLQ
- **THEN** the handler returns an error response (job not found)

#### Scenario: DLQ_PURGE removes all DLQ jobs for a queue
- **WHEN** `DLQ_PURGE` is received with `{ queue: 'email-queue' }`
- **THEN** the handler calls `EmailDlqService.purge()` and returns `{ removed: number }`

#### Scenario: Unknown queue
- **WHEN** any DLQ handler is received with `{ queue: 'other-queue' }`
- **THEN** the handler returns an error response and no queue is touched

### Requirement: A read-only queue dashboard is mounted in the worker app at /admin/queues
The worker app SHALL mount the Bull Board NestJS adapter at the path `/admin/queues`. `email-queue`, `email-queue-dlq`, `push-queue` and `push-queue-dlq` SHALL be visible in the Bull Board UI. Access SHALL be limited to authenticated admins, and each kind of rejected caller SHALL be distinguishable by status code alone.

#### Scenario: Bull Board shows both queues
- **WHEN** an authenticated admin user navigates to `/admin/queues`
- **THEN** the Bull Board UI renders with `email-queue`, `email-queue-dlq`, `push-queue` and `push-queue-dlq` listed

#### Scenario: Unauthenticated access is rejected
- **WHEN** a request without a valid admin session accesses `/admin/queues`
- **THEN** the server responds with 401 Unauthorized

#### Scenario: Non-admin access is forbidden
- **WHEN** an authenticated user whose role is not `admin` accesses `/admin/queues`
- **THEN** the server responds with 403 Forbidden and no queue content is returned

#### Scenario: Auth service unavailable
- **WHEN** the auth service does not answer within the bounded time, or cannot be reached, for a request to `/admin/queues`
- **THEN** the server responds with 503 Service Unavailable, not 401

#### Scenario: The dashboard changes no job
- **WHEN** an admin sends a request through the dashboard to retry, remove, clean, promote or edit a job, or to pause a queue
- **THEN** the request is refused and every job and queue keeps its state
- **AND** replaying a DLQ job remains available only through `DLQ_REPLAY`

### Requirement: The dashboard never shows account links
Job data displayed by the dashboard SHALL have every password-reset, email-verification and account-invitation link replaced by a fixed placeholder. Other job data fields SHALL remain visible.

#### Scenario: Password reset job
- **WHEN** an admin opens a password-reset email job in either queue
- **THEN** its `resetLink` is shown as a placeholder and the recipient email is shown

#### Scenario: Verification job in the DLQ
- **WHEN** an admin opens an email-verification job in `email-queue-dlq`
- **THEN** its `verificationLink` is shown as a placeholder

#### Scenario: Invitation job
- **WHEN** an admin opens an account-invitation email job in either queue
- **THEN** its invitation link is shown as a placeholder and the recipient email is shown

#### Scenario: Redaction does not alter the job
- **WHEN** a redacted job is later replayed through `DLQ_REPLAY`
- **THEN** the replayed job carries the original, unredacted link
