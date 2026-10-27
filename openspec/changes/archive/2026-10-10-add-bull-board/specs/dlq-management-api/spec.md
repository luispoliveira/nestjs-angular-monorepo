## REMOVED Requirements

### Requirement: Bull Board is mounted in the worker app at /admin/queues
**Reason**: its "Bull Board allows manual job replay" scenario cannot hold: DLQ jobs wait in a queue with no consumer, and the dashboard's retry re-runs a failed job in its own queue, never moving it to `email-queue`.
**Migration**: replaced by "A read-only queue dashboard is mounted in the worker app at /admin/queues" below; replay stays on `DLQ_REPLAY`.

## ADDED Requirements

### Requirement: A read-only queue dashboard is mounted in the worker app at /admin/queues
The worker app SHALL mount the Bull Board NestJS adapter at the path `/admin/queues`. Both `email-queue` and `email-queue-dlq` SHALL be visible in the Bull Board UI. Access SHALL be limited to authenticated admins, and each kind of rejected caller SHALL be distinguishable by status code alone.

#### Scenario: Bull Board shows both queues
- **WHEN** an authenticated admin user navigates to `/admin/queues`
- **THEN** the Bull Board UI renders with `email-queue` and `email-queue-dlq` listed

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
Job data displayed by the dashboard SHALL have every password-reset and email-verification link replaced by a fixed placeholder. Other job data fields SHALL remain visible.

#### Scenario: Password reset job
- **WHEN** an admin opens a password-reset email job in either queue
- **THEN** its `resetLink` is shown as a placeholder and the recipient email is shown

#### Scenario: Verification job in the DLQ
- **WHEN** an admin opens an email-verification job in `email-queue-dlq`
- **THEN** its `verificationLink` is shown as a placeholder

#### Scenario: Redaction does not alter the job
- **WHEN** a redacted job is later replayed through `DLQ_REPLAY`
- **THEN** the replayed job carries the original, unredacted link
