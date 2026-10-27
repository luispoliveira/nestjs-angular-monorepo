# Spec Delta

## Purpose

Defines how an outgoing email reaches a mail provider: which provider is used, what an email can carry, and how a delivery failure is reported back so queued sends are retried.

## ADDED Requirements

### Requirement: The mail provider is selected by environment
The worker SHALL send email through exactly one provider, chosen by `MAIL_PROVIDER`, whose accepted values are `brevo` and `resend`. When `MAIL_PROVIDER` is not set, the provider SHALL be `brevo`. Any other value SHALL make the worker fail at boot with an error naming `MAIL_PROVIDER`.

#### Scenario: No provider configured
- **WHEN** the worker starts without `MAIL_PROVIDER`
- **THEN** emails are sent through Brevo

#### Scenario: Resend selected
- **WHEN** the worker starts with `MAIL_PROVIDER=resend`
- **THEN** emails are sent through Resend and Brevo is not contacted

#### Scenario: Unknown provider
- **WHEN** the worker starts with `MAIL_PROVIDER=sendgrid`
- **THEN** the worker fails at boot with an error identifying `MAIL_PROVIDER`

### Requirement: Only the active provider's credentials are required
The worker SHALL require `BREVO_API_KEY` when the active provider is Brevo and `RESEND_API_KEY` when it is Resend, and SHALL NOT require the inactive provider's key. `FROM_EMAIL` SHALL be required for either provider.

#### Scenario: Resend active without a Brevo key
- **WHEN** the worker starts with `MAIL_PROVIDER=resend`, `RESEND_API_KEY` set and no `BREVO_API_KEY`
- **THEN** the worker boots successfully

#### Scenario: Active provider key missing
- **WHEN** the worker starts with `MAIL_PROVIDER=resend` and no `RESEND_API_KEY`
- **THEN** the worker fails at boot with an error identifying `RESEND_API_KEY`

### Requirement: An email can carry an HTML body with a plain-text alternative
An email SHALL be able to carry a subject, an HTML body and a plain-text body, sent to one or more recipients with optional cc, bcc and attachments. Both providers SHALL deliver the same subject, HTML and text. The sender SHALL be `FROM_EMAIL`, displayed as `FROM_NAME` when set.

#### Scenario: HTML email through either provider
- **WHEN** an email with a subject, an HTML body and a text body is sent
- **THEN** the recipient receives that subject with the HTML body and the text body as its alternative, whichever provider is active

#### Scenario: Sender identity
- **WHEN** an email is sent with `FROM_EMAIL=no-reply@example.com` and `FROM_NAME=App`
- **THEN** the email's sender is `App <no-reply@example.com>`

### Requirement: A provider rejection is reported as a failure
When the provider rejects a send, whether it throws or returns an error result, the send SHALL fail with an error carrying the provider's message and SHALL NOT be recorded in the email log as sent. A failed send from a queued job SHALL fail that job, so retry and dead-letter handling apply.

#### Scenario: Provider returns an error result
- **WHEN** the provider answers a send with an error result (for example, an unverified sender domain) instead of throwing
- **THEN** the send fails with that error's message
- **AND** no email-log entry is written for it

#### Scenario: Queued job after a rejection
- **WHEN** a queued email job's send is rejected by the provider on every attempt
- **THEN** the job is retried according to the queue's retry policy
- **AND** after its final failed attempt it is moved to the email dead-letter queue

### Requirement: Development mode redirects or suppresses email
In development, every email SHALL be redirected to `DEV_EMAIL`, with the original recipients named in the subject and cc/bcc removed. When `DEV_EMAIL` is not set in development, no email SHALL be sent. This SHALL apply identically to both providers.

#### Scenario: Development redirect
- **WHEN** an email to `alice@example.com` is sent in development with `DEV_EMAIL=dev@example.com`
- **THEN** it is delivered to `dev@example.com` only, with `alice@example.com` named in the subject

#### Scenario: Development without a dev address
- **WHEN** an email is sent in development with no `DEV_EMAIL`
- **THEN** no provider is contacted
