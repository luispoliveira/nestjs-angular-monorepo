# account-invitation Specification

## Purpose
Lets an administrator create an account without ever handling its password: the new user is emailed an invitation to choose their own, and setting it activates the account.

## Requirements

### Requirement: An admin-created account receives an invitation
When an administrator creates an account, the system SHALL email its address an invitation with a single-use link to `/reset-password` for choosing a password. The email SHALL state that the link expires after one hour and that a new one can be requested from the sign-in page. Accounts created any other way SHALL NOT receive an invitation.

#### Scenario: Administrator creates an account
- **WHEN** an administrator creates an account for `alice@example.com`
- **THEN** `alice@example.com` receives an invitation email with a link to `/reset-password?token=<token>`
- **AND** the email states the one-hour expiry and how to request a new link

#### Scenario: Seeded administrator
- **WHEN** the seeder creates the configured administrator account
- **THEN** no invitation email is sent

#### Scenario: Social sign-in creates an account
- **WHEN** a user's first social sign-in creates their account
- **THEN** no invitation email is sent

### Requirement: An admin-created account receives exactly one email
Creating an account from the administration SHALL send exactly one email, the invitation. The welcome email SHALL NOT be sent for it.

#### Scenario: One email on account creation
- **WHEN** an administrator creates an account
- **THEN** exactly one email, the invitation, is sent to the new account

### Requirement: Setting the first password activates the account
When a user sets a password through a reset link while their email is still unverified, the system SHALL mark the email as verified and SHALL send an "Account activated" email instead of a password-changed notice. The user SHALL then be able to sign in with that password.

#### Scenario: Invited user sets their password
- **WHEN** an invited user opens their invitation link and sets a valid password
- **THEN** their email is marked verified
- **AND** they receive an "Account activated" email and no "password changed" email
- **AND** they can sign in with that password

#### Scenario: Verified user resets their password
- **WHEN** a user whose email is already verified completes a password reset
- **THEN** they receive the existing "password changed" email and no "Account activated" email

### Requirement: A reset for a never-activated account re-sends the invitation
When a password reset is requested for an account that has never set a password, the system SHALL send the invitation again with a fresh link instead of a reset email. A request for an unknown email SHALL send nothing and SHALL get the same response as a known email.

#### Scenario: Expired invitation
- **WHEN** an invited user whose link expired requests a password reset from the sign-in page
- **THEN** they receive a new invitation email with a fresh link

#### Scenario: Unknown email
- **WHEN** a reset is requested for an email with no account
- **THEN** no email is sent
- **AND** the response is indistinguishable from a request for an existing account

### Requirement: Invitation and activation emails carry HTML and text bodies
The invitation and activation emails SHALL each have an English subject, an HTML body and an equivalent plain-text body. Every link SHALL start with the web application's configured base URL and SHALL appear in full in the text body. No email SHALL contain a password.

#### Scenario: Link targets the configured web app
- **WHEN** an invitation is sent with the web app's base URL set to `https://app.example.com`
- **THEN** its link starts with `https://app.example.com/reset-password`
- **AND** the full link is present in the plain-text body

### Requirement: A refused account change sends no notice
A "password changed", "two-factor enabled" or "two-factor disabled" email SHALL be sent only when that change actually happened. A signed-in password change, an administrator set-password, or a two-factor enable/disable that the auth service refused SHALL send no email.

#### Scenario: Wrong current password
- **WHEN** a signed-in user's password change is refused because the current password is wrong
- **THEN** no email is sent

#### Scenario: Refused two-factor disable
- **WHEN** a signed-in user's request to disable two-factor is refused because the password is wrong
- **THEN** no email is sent
