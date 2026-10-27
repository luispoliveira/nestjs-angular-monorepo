# Spec Delta

## MODIFIED Requirements

### Requirement: Administrators can manage user accounts

An administrator SHALL be able to list users with pagination, filter them by role and by banned status, search them by email, create a user, change a user's role, ban a user with an optional reason and an optional expiry, unban a user, and delete a user. Creating a user SHALL NOT generate, show or send a password through the administrator; the new user is invited by email instead. Each operation SHALL report its outcome to the user, distinguishing success from failure.

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
- **THEN** the user is created without a password
- **AND** a success message is shown stating that an invitation was emailed to the user
- **AND** no password is displayed or copied anywhere
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

### Requirement: Dialogs occupy the full viewport on a narrow screen
On a viewport narrower than the mobile breakpoint, every dialog the web app opens SHALL occupy the full viewport instead of a fixed-width centred card. On wider viewports, dialog sizing SHALL be unchanged.

#### Scenario: A dialog on a phone
- **WHEN** a user opens the create-user dialog on a viewport narrower than the mobile breakpoint
- **THEN** the dialog fills the whole viewport and its content is not clipped

#### Scenario: Desktop dialog sizing is unaffected
- **WHEN** a user opens the same dialog on a desktop viewport
- **THEN** it renders with its usual width, centred
