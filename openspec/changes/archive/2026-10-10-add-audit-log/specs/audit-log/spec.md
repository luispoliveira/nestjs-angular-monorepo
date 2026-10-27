# Spec Delta

## Purpose

Keeps an append-only trail of authentication, account-management and business write events: who did what, to whom, when, and with what outcome. It supports security investigations and answers "who changed this?" without exposing protected personal data.

## ADDED Requirements

### Requirement: Authentication and account-management actions are recorded

The system SHALL record an audit event for each of these actions, whether it succeeds or fails: sign-in, sign-up, sign-out, password change, password reset request and completion, email change, email verification, profile update, account deletion, session revocation (single, all, others), 2FA enable, disable, backup-code generation and verification (TOTP, OTP, backup code).

#### Scenario: Successful sign-in

- **WHEN** a user signs in with valid credentials
- **THEN** an event with action `auth.sign-in`, outcome `success` and that user as actor is recorded

#### Scenario: 2FA enabled

- **WHEN** a signed-in user enables 2FA
- **THEN** an event with action `auth.two-factor.enable`, outcome `success`, and that user as both actor and target is recorded

### Requirement: Admin user-management actions are recorded

The system SHALL record an audit event for each admin action on users, whether it succeeds or fails: create, update, remove, ban, unban, set role, set password, impersonate, stop impersonating, and revoke one or all of a user's sessions. The event SHALL identify the admin as actor and the affected user as target.

#### Scenario: Admin bans a user

- **WHEN** an admin bans user U with a reason
- **THEN** an event with action `admin.user.ban`, the admin as actor, U as target and outcome `success` is recorded

#### Scenario: Revoked session names its owner

- **WHEN** an admin revokes a user's session, addressing it by session token only
- **THEN** the `admin.user.revoke-session` event has that session's owner as target

#### Scenario: Admin changes a role

- **WHEN** an admin sets user U's role from `user` to `admin`
- **THEN** the event `admin.user.set-role` records `role` as a changed field with the new value `admin`

### Requirement: Customer write actions are recorded

The system SHALL record an audit event for each customer create, update and delete, whether it succeeds or fails. That includes requests rejected by authentication or role checks. The event SHALL identify the customer as target when it exists.

#### Scenario: Customer updated

- **WHEN** an admin updates a customer's name and NIF
- **THEN** an event `customer.update` with that customer as target records `name` and `taxId` as changed fields

#### Scenario: Non-admin write rejected

- **WHEN** an authenticated non-admin tries to delete a customer and receives 403
- **THEN** an event `customer.delete` with outcome `failure`, error code 403, and the non-admin as actor is recorded

#### Scenario: Unauthenticated write rejected

- **WHEN** a request without a session tries to create a customer and receives 401
- **THEN** an event `customer.create` with outcome `failure`, error code 401 and no actor is recorded

### Requirement: Read operations are not recorded

The system SHALL NOT record audit events for read-only operations. That includes session lookups, list and get endpoints of users, sessions and customers, and queries of the audit log itself.

#### Scenario: Session lookup

- **WHEN** the web app fetches the current session
- **THEN** no audit event is recorded

#### Scenario: Customer list

- **WHEN** a user lists or views customers
- **THEN** no audit event is recorded

### Requirement: Each event has a defined content

Every audit event SHALL contain: a unique id, the time it occurred, the action, the outcome (`success` or `failure`), the actor (user id and email, or none when unauthenticated), the target (type and id, when applicable), the client IP, the user agent and the request correlation ID. A failure SHALL also carry its error code.

#### Scenario: Event content

- **WHEN** any recorded action completes
- **THEN** its event contains every field above that applies, and the correlation ID matches the one returned for that request

### Requirement: Impersonated actions name the real admin

When an action is performed during an impersonation session, the event SHALL record the impersonated user as actor and the admin who started the impersonation as `impersonatedBy`.

#### Scenario: Action during impersonation

- **WHEN** admin A impersonates user U and changes U's profile name
- **THEN** the `auth.update-user` event has U as actor and A as `impersonatedBy`

### Requirement: Failed attempts are recorded without secrets

A failed action SHALL be recorded with outcome `failure` and its error code. A failed sign-in SHALL record the attempted email even when no account exists for it. No event SHALL ever contain a password, token, 2FA code, backup code or session identifier.

#### Scenario: Wrong password

- **WHEN** someone signs in with an existing email and a wrong password
- **THEN** an `auth.sign-in` event with outcome `failure`, the attempted email and the error code is recorded, and the password appears nowhere in it

#### Scenario: Unknown email

- **WHEN** someone signs in with an email that has no account
- **THEN** an `auth.sign-in` failure event with that attempted email and no actor id is recorded

### Requirement: Change details never expose protected values

An event for an update SHALL list the names of the changed fields. It SHALL include the new value only for fields on a fixed safe list (`role`, `banned`, `banReason`, `banExpires`). Values of any other field SHALL be omitted, which includes `name`, `email`, `taxId`, `password` and `notes`.

#### Scenario: NIF change

- **WHEN** an admin changes a customer's NIF
- **THEN** the event lists `taxId` as changed and contains neither the old nor the new NIF

#### Scenario: Ban with reason

- **WHEN** an admin bans a user with reason "spam"
- **THEN** the event includes `banned: true` and `banReason: "spam"` as changed values

### Requirement: A failed action records no changes

A failed action SHALL record neither changed field names nor change values, because nothing was changed. The action, actor, target and error code identify the attempt.

#### Scenario: Refused role change

- **WHEN** a non-admin tries to set a user's role and is refused with 403
- **THEN** the `admin.user.set-role` failure event carries the target and the error code, and no changed fields or values

#### Scenario: Rejected customer write

- **WHEN** a customer create is rejected because the NIF is already in use
- **THEN** the failure event lists no changed fields

### Requirement: Writing an audit event never affects the audited action

Recording SHALL be best-effort. If an event cannot be stored, the audited action SHALL complete with exactly the result it would have had, and the storage failure SHALL be logged and reported to error tracking with the action and correlation ID. A storage that hangs SHALL NOT delay the response by more than five seconds.

#### Scenario: Audit storage unavailable

- **WHEN** an admin bans a user while audit storage is unavailable
- **THEN** the ban succeeds with its normal response, and an error naming `admin.user.ban` and the correlation ID is logged and reported

#### Scenario: Audit storage hangs

- **WHEN** a user signs in while audit storage accepts connections but never answers
- **THEN** the sign-in response is returned within five seconds with its normal result

### Requirement: Client-controlled event fields are size-bounded

The system SHALL cap the size of every event field that takes its value from a client: text fields (emails, user agent, ids, error code, address), the number and length of changed-field names, and the length of any stored change value. A value over its cap SHALL be truncated, not rejected, and the audited action SHALL be unaffected.

#### Scenario: Oversized attempted email

- **WHEN** an unauthenticated request signs in with a 200 000-character email
- **THEN** the sign-in is rejected as usual and the stored attempted email is at most 254 characters

#### Scenario: Many changed fields

- **WHEN** a signed-in user sends a profile update naming 3 000 fields
- **THEN** the event lists at most 50 field names, each at most 64 characters

### Requirement: The recorded client address is the one a trusted proxy reports

The client address in an event SHALL be the address added by the trusted reverse proxy (the entry counted from the right of `X-Forwarded-For` by the configured number of trusted proxies), never the first entry, which the client controls. When that entry is not a valid IP address, no address SHALL be recorded.

#### Scenario: Forged forwarded address

- **WHEN** a client sends `X-Forwarded-For: 6.6.6.6` and the trusted proxy appends the real address `198.51.100.9`
- **THEN** the event records `198.51.100.9`

#### Scenario: Header that is not an address

- **WHEN** the entry counted from the right is not an IP address (for example `evil<script>`)
- **THEN** the event records no client address

### Requirement: Audit events are retained for a configurable period

Each event SHALL be deleted automatically once it is older than the configured retention, set in days by `AUDIT_RETENTION_DAYS` (default 365). Changing the setting SHALL apply to events recorded afterwards without failing startup.

#### Scenario: Default retention

- **WHEN** `AUDIT_RETENTION_DAYS` is not set
- **THEN** a new event is scheduled to expire 365 days after it occurred

#### Scenario: Changed retention

- **WHEN** the service restarts with `AUDIT_RETENTION_DAYS=90` after running with 365
- **THEN** startup succeeds, and events recorded afterwards expire 90 days after they occurred

### Requirement: Audit events are immutable

The system SHALL offer no operation to edit or delete individual audit events. Events leave storage only through retention expiry.

#### Scenario: No mutation endpoint

- **WHEN** an admin sends PATCH, PUT or DELETE to the audit events resource
- **THEN** the request is rejected and no event changes

### Requirement: Admins can query audit events

The API SHALL expose audit events read-only at `GET /api/v1/audit-events`, to admins only. Results SHALL be newest first, paginated in the shared paginated shape (`take` 1–100, default 20), and filterable by actor id, actor email, target id, action, outcome and an occurred-at date range. The actor email SHALL also match the attempted email of failed sign-ins, which have no actor. Any combination of filters SHALL be allowed.

#### Scenario: Filter by target

- **WHEN** an admin requests events with `targetId` set to user U
- **THEN** only events targeting U are returned, newest first, with `meta.total` counting all matches

#### Scenario: Filter by actor email

- **WHEN** an admin requests events with `actorEmail` set to a user's email in any letter case
- **THEN** the events of that actor are returned, together with the failed sign-ins that tried that email

#### Scenario: Non-admin access

- **WHEN** an authenticated non-admin requests audit events
- **THEN** the response is 403

#### Scenario: Unauthenticated access

- **WHEN** a request without a session requests audit events
- **THEN** the response is 401

### Requirement: Admin UI shows the audit log

The web app SHALL provide an `/audit` page, reachable from the navigation only by admins. It SHALL show a paginated table of events (time, actor, impersonated by, action, target, outcome) and offer filters for action, outcome, actor (by email or id), target and date range. The actor cell SHALL expose the actor's id. Non-admins SHALL be redirected away from it.

#### Scenario: Admin views and filters

- **WHEN** an admin opens `/audit` and filters by outcome `failure`
- **THEN** the table shows only failed events, newest first

#### Scenario: Non-admin redirected

- **WHEN** a non-admin opens `/audit`
- **THEN** they are redirected to the dashboard and the navigation shows no audit entry
