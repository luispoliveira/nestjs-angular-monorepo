# Spec Delta

## MODIFIED Requirements

### Requirement: worker app reaches 80% unit test coverage

The `apps/worker` app SHALL have unit tests covering `DlqController`, `EmailDlqService`, `QueueMetricsService`, and the uncovered branches in `EmailConsumer` such that `pnpm test:cov` exits 0 with ≥80% statements, branches, functions, and lines.

#### Scenario: DlqController.list delegates to emailDlqService.list
- **WHEN** `DlqController.list()` is called with page and limit
- **THEN** `emailDlqService.list` is called with those values and the result is returned

#### Scenario: DlqController.replay delegates to emailDlqService.replay
- **WHEN** `DlqController.replay()` is called with a jobId
- **THEN** `emailDlqService.replay` is called with that jobId and `{ success: true }` is returned

#### Scenario: DlqController.purge delegates to emailDlqService.purge
- **WHEN** `DlqController.purge()` is called
- **THEN** `emailDlqService.purge` is called and `{ removed: <count> }` is returned

#### Scenario: EmailDlqService can be instantiated with queue injection
- **WHEN** `EmailDlqService` is constructed with mock DLQ and original queues
- **THEN** the instance is defined and is an instance of `BaseDlqService`

#### Scenario: QueueMetricsService.recordDuration observes histogram
- **WHEN** `QueueMetricsService.recordDuration` is called with a job name and duration in ms
- **THEN** the `@prometheus-io/client` histogram `observe` is called with the correct labels and duration in seconds

#### Scenario: QueueMetricsService.recordFailure increments counter
- **WHEN** `QueueMetricsService.recordFailure` is called with a job name
- **THEN** the `@prometheus-io/client` counter `inc` is called with the correct labels

#### Scenario: EmailConsumer processes sendPasswordResetEmail job
- **WHEN** `EmailConsumer.process()` is called with a job named `JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL`
- **THEN** `mailService.send` is called with the correct password-reset template

#### Scenario: EmailConsumer processes sendEmailVerificationEmail job
- **WHEN** `EmailConsumer.process()` is called with a job named `JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL`
- **THEN** `mailService.send` is called with the correct email-verification template

#### Scenario: EmailConsumer processes sendPasswordChangedEmail job
- **WHEN** `EmailConsumer.process()` is called with a job named `JOB_PATTERNS.SEND_PASSWORD_CHANGED_EMAIL`
- **THEN** `mailService.send` is called with the correct password-changed template

#### Scenario: EmailConsumer processes sendTwoFactorEnabledEmail job
- **WHEN** `EmailConsumer.process()` is called with a job named `JOB_PATTERNS.SEND_TWO_FACTOR_ENABLED_EMAIL`
- **THEN** `mailService.send` is called with the correct 2FA-enabled template

#### Scenario: EmailConsumer processes sendTwoFactorDisabledEmail job
- **WHEN** `EmailConsumer.process()` is called with a job named `JOB_PATTERNS.SEND_TWO_FACTOR_DISABLED_EMAIL`
- **THEN** `mailService.send` is called with the correct 2FA-disabled template
