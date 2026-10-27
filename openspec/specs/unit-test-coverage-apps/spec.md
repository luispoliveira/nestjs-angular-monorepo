# unit-test-coverage-apps Specification

## Purpose

Sets the minimum unit-test coverage bar for the NestJS apps (auth, notifications, worker) and the behaviours their tests must exercise.

## Requirements

### Requirement: auth app reaches 80% unit test coverage

The `apps/auth` app SHALL have unit tests covering `LocalAuthService` such that `pnpm test:cov` exits 0 with ≥80% statements, branches, functions, and lines.

#### Scenario: ensureAdminUser skips creation when admin already exists
- **WHEN** `LocalAuthService.ensureAdminUser()` is called and `DatabaseService.user.findUnique` returns an existing user
- **THEN** `authService.api.signUpEmail` is NOT called

#### Scenario: ensureAdminUser creates admin when user does not exist
- **WHEN** `LocalAuthService.ensureAdminUser()` is called and `DatabaseService.user.findUnique` returns null
- **THEN** `authService.api.signUpEmail` is called with the configured admin email and password
- **THEN** `DatabaseService.user.update` is called to set `emailVerified: true` and `role: 'admin'`

#### Scenario: handlePasswordChanged emits notification for authenticated user
- **WHEN** `LocalAuthService.handlePasswordChanged()` is called with a valid session context
- **THEN** `notificationsPublisher.emitUserPasswordChanged` is called with the user id, email, and reason

#### Scenario: handlePasswordChanged throws when session is not found
- **WHEN** `LocalAuthService.handlePasswordChanged()` is called and `authService.api.getSession` returns null
- **THEN** an Error is thrown with message "Session not found"

#### Scenario: handleTwoFactorEnabled emits notification
- **WHEN** `LocalAuthService.handleTwoFactorEnabled()` is called with a valid session context
- **THEN** `notificationsPublisher.emitUserTwoFactorEnabled` is called with user id and email

#### Scenario: handleTwoFactorDisabled emits notification
- **WHEN** `LocalAuthService.handleTwoFactorDisabled()` is called with a valid session context
- **THEN** `notificationsPublisher.emitUserTwoFactorDisabled` is called with user id and email

---

### Requirement: notifications app reaches 80% unit test coverage

The `apps/notifications` app SHALL have unit tests covering `AppController` and all `AppService` methods such that `pnpm test:cov` exits 0 with ≥80% statements, branches, functions, and lines.

#### Scenario: AppController.sendUserCreatedNotification validates and delegates
- **WHEN** `sendUserCreatedNotification` is called with a valid payload
- **THEN** `appService.sendUserCreatedNotification` is called with the validated email

#### Scenario: AppController.sendPasswordResetNotification delegates with email and token
- **WHEN** `sendPasswordResetNotification` is called with a valid payload
- **THEN** `appService.sendPasswordResetNotification` is called with email and resetToken

#### Scenario: AppController.sendPasswordChangeConfirmation delegates
- **WHEN** `sendPasswordChangeConfirmation` is called with a valid payload
- **THEN** `appService.sendPasswordChangeConfirmation` is called with the email

#### Scenario: AppController.sendEmailVerificationNotification delegates with link
- **WHEN** `sendEmailVerificationNotification` is called with a valid payload
- **THEN** `appService.sendEmailVerificationNotification` is called with email and verificationLink

#### Scenario: AppController.sendTwoFactorEnabledNotification delegates
- **WHEN** `sendTwoFactorEnabledNotification` is called with a valid payload
- **THEN** `appService.sendTwoFactorEnabledNotification` is called with the email

#### Scenario: AppController.sendTwoFactorDisabledNotification delegates
- **WHEN** `sendTwoFactorDisabledNotification` is called with a valid payload
- **THEN** `appService.sendTwoFactorDisabledNotification` is called with the email

#### Scenario: AppService.sendPasswordChangeConfirmation delegates to producer
- **WHEN** `AppService.sendPasswordChangeConfirmation` is called with an email
- **THEN** `EmailProducer.sendPasswordChangedEmail` is called with that email

#### Scenario: AppService.sendTwoFactorEnabledNotification delegates to producer
- **WHEN** `AppService.sendTwoFactorEnabledNotification` is called with an email
- **THEN** `EmailProducer.sendTwoFactorEnabledEmail` is called with that email

#### Scenario: AppService.sendTwoFactorDisabledNotification delegates to producer
- **WHEN** `AppService.sendTwoFactorDisabledNotification` is called with an email
- **THEN** `EmailProducer.sendTwoFactorDisabledEmail` is called with that email

---

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
