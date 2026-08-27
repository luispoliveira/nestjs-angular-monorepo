## MODIFIED Requirements

### Requirement: Administrators can manage user accounts

An administrator SHALL be able to list users with pagination, filter them by role and by banned status, search them by email, create a user, change a user's role, ban a user with an optional reason and an optional expiry, unban a user, and delete a user. Each operation SHALL report its outcome to the user, distinguishing success from failure.

#### Scenario: Listing users with pagination

- **WHEN** an administrator opens `/users`
- **THEN** a page of users is displayed
- **AND** navigating to the next page displays the following page of users

#### Scenario: Searching users by email

- **WHEN** an administrator types a partial email into the search field
- **THEN** the list is reduced to users whose email contains that value
- **AND** the list returns to the first page

#### Scenario: Creating a user

- **WHEN** an administrator submits a valid new user with name, email and role
- **THEN** the user is created
- **AND** a success message is shown
- **AND** the user list reflects the new user

#### Scenario: Changing a user's role

- **WHEN** an administrator changes a user's role and confirms
- **THEN** the new role is persisted
- **AND** a success message is shown

#### Scenario: Banning and unbanning a user

- **WHEN** an administrator bans a user
- **THEN** the user is shown as banned
- **AND** unbanning the same user returns them to the active state

#### Scenario: Banning a user with a reason and an expiry

- **WHEN** an administrator bans a user and supplies a reason and an expiry duration
- **THEN** the user is shown as banned
- **AND** the recorded reason and expiry are shown wherever the user's ban state is displayed

#### Scenario: Banning a user without a reason or expiry

- **WHEN** an administrator bans a user without supplying a reason or an expiry
- **THEN** the user is shown as banned with no reason or expiry displayed
- **AND** the ban does not expire on its own

#### Scenario: Unbanning clears the displayed ban reason and expiry

- **WHEN** an administrator unbans a user who was banned with a reason and an expiry
- **THEN** the user returns to the active state
- **AND** any previously displayed ban reason or expiry is no longer shown

#### Scenario: A management operation fails

- **WHEN** any user management operation is rejected by the server
- **THEN** an error message is shown
- **AND** the displayed list is not left showing the un-persisted change

## ADDED Requirements

### Requirement: Administrators can view a single user's full detail

The application SHALL serve an admin-only route showing one user's full detail: identity (name, email, creation date), role, and current ban state including reason and expiry when present. This route is subject to the same authentication and admin-role gating as every other admin-only route.

#### Scenario: Opening a user's detail page

- **WHEN** an administrator selects a user from `/users`
- **THEN** the application navigates to that user's detail route
- **AND** the user's identity, role, and ban state are displayed

#### Scenario: Detail route is admin-gated

- **WHEN** a non-admin authenticated user opens a user detail route directly
- **THEN** the application navigates to `/dashboard`
- **AND** no user detail is rendered at any point

#### Scenario: Detail route requires an existing user

- **WHEN** an administrator opens a user detail route for a user id that does not exist
- **THEN** an error state is shown instead of the detail view

### Requirement: Administrators can manage a user's active sessions

From a user's detail page, an administrator SHALL be able to list that user's active sessions, revoke a single session, and revoke all of that user's sessions at once. Revoking a session immediately invalidates it for the affected user.

#### Scenario: Listing a user's sessions

- **WHEN** an administrator opens a user's detail page
- **THEN** the user's active sessions are listed

#### Scenario: Revoking a single session

- **WHEN** an administrator revokes one listed session
- **THEN** that session no longer appears among the user's active sessions
- **AND** a success message is shown

#### Scenario: Revoking all sessions

- **WHEN** an administrator revokes all of a user's sessions
- **THEN** the user's session list becomes empty
- **AND** a success message is shown

### Requirement: Administrators can set a user's password directly

From a user's detail page, an administrator SHALL be able to set a new password for that user without going through the reset-password email flow. The affected user SHALL be notified that their password changed.

#### Scenario: Setting a user's password

- **WHEN** an administrator submits a new password for a user
- **THEN** the user's password is updated
- **AND** a success message is shown to the administrator
- **AND** the affected user is sent a password-changed notification

#### Scenario: Password does not meet requirements

- **WHEN** an administrator submits a password that fails the shared password policy
- **THEN** an error is shown against the password field
- **AND** the password is not changed

### Requirement: Administrators can impersonate a user

From a user's detail page, an administrator SHALL be able to start an impersonation session for a non-admin user and end it at any time. While impersonating, the application SHALL display a persistent, always-visible indicator naming the impersonated user, with a control to stop impersonating that is reachable from every route. An administrator SHALL NOT be able to impersonate an admin user or themselves.

#### Scenario: Starting impersonation

- **WHEN** an administrator starts impersonating a non-admin user
- **THEN** the application's session reflects the impersonated user
- **AND** a persistent indicator naming the impersonated user is shown on every route

#### Scenario: Stopping impersonation

- **WHEN** an administrator stops impersonating from the persistent indicator's control
- **THEN** the application's session reverts to the administrator's own session
- **AND** the persistent indicator is no longer shown

#### Scenario: Impersonation is unavailable for admin users

- **WHEN** an administrator views another administrator's detail page
- **THEN** the impersonate control is not offered

#### Scenario: Impersonation is unavailable for the administrator's own account

- **WHEN** an administrator views their own detail page
- **THEN** the impersonate control is not offered
