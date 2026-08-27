## Purpose

Defines the observable behaviour of the admin dashboard single-page application: which routes exist, how access to them is gated, how session and theme state persist, and what a user can do with user accounts. It is the contract that survives the Next.js → Angular replacement, so the same scenarios must pass before and after.

## ADDED Requirements

### Requirement: Route paths are preserved across the frontend replacement

The application SHALL serve the routes `/sign-in`, `/dashboard` and `/users`. Navigation SHALL use path-based URLs — the application SHALL NOT use fragment/hash-based routing — so that every route is a shareable, bookmarkable URL.

#### Scenario: Existing bookmarks continue to resolve

- **WHEN** an authenticated user opens `/users` directly
- **THEN** the users screen is rendered
- **AND** the address bar shows `/users` with no `#` fragment

#### Scenario: Deep link survives a full page reload

- **WHEN** an authenticated user is on `/users` and triggers a full browser reload
- **THEN** the users screen is rendered again
- **AND** the user is not redirected to `/` or shown a 404

---

### Requirement: Protected routes are gated before protected content renders

Every route other than `/sign-in` SHALL require an authenticated session. While the session is being resolved, the application SHALL render a loading placeholder and SHALL NOT render protected content. When no session exists, the application SHALL navigate to `/sign-in`.

#### Scenario: Unauthenticated user requests a protected route

- **WHEN** a user with no valid session opens `/users`
- **THEN** the application navigates to `/sign-in`
- **AND** no user data from `/users` is rendered at any point

#### Scenario: Session resolution is pending

- **WHEN** a route activation is waiting on session resolution
- **THEN** a loading placeholder is displayed
- **AND** dashboard or user data is not displayed

#### Scenario: Authenticated user requests the sign-in route

- **WHEN** a user with a valid session opens `/sign-in`
- **THEN** the application navigates to `/dashboard`

---

### Requirement: Admin-only routes enforce the admin role

Routes reserved for administrators SHALL be accessible only to sessions whose user role is the admin role defined in the shared types package. A non-admin authenticated user SHALL be redirected to `/dashboard`.

#### Scenario: Non-admin user requests an admin route

- **WHEN** an authenticated user whose role is not admin opens an admin-only route
- **THEN** the application navigates to `/dashboard`
- **AND** the admin-only content is not rendered

#### Scenario: Admin user requests an admin route

- **WHEN** an authenticated user whose role is admin opens an admin-only route
- **THEN** the route is activated and its content is rendered

---

### Requirement: Session state is reactive and consistent across the application

The application SHALL expose the current session as reactive state derived from the authentication client. When the session changes — sign-in, sign-out, or expiry — every part of the UI that depends on it SHALL update without a manual page reload.

#### Scenario: Sign-out updates the whole UI

- **WHEN** an authenticated user signs out
- **THEN** the application navigates to `/sign-in`
- **AND** the identity shown in the top bar is cleared

#### Scenario: Sign-in populates session-dependent UI

- **WHEN** a user submits valid credentials on `/sign-in`
- **THEN** the application navigates to `/dashboard`
- **AND** the signed-in user's name is shown in the top bar

#### Scenario: Navigation reflects the session's role

- **WHEN** an authenticated non-admin user views the navigation
- **THEN** admin-only navigation entries are not offered

---

### Requirement: Administrators can manage user accounts

An administrator SHALL be able to list users with pagination, filter them by role and by banned status, search them by email, create a user, change a user's role, ban a user, unban a user, and delete a user. Each operation SHALL report its outcome to the user, distinguishing success from failure.

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

#### Scenario: A management operation fails

- **WHEN** any user management operation is rejected by the server
- **THEN** an error message is shown
- **AND** the displayed list is not left showing the un-persisted change

---

### Requirement: Forms validate against the shared schemas before submitting

Form input SHALL be validated against the schemas published by the shared types package — the same schemas the backend validates with. Validation errors SHALL be shown against the offending field, and submission SHALL be prevented while the form is invalid.

#### Scenario: Invalid email is rejected client-side

- **WHEN** an administrator enters a malformed email in the create-user form
- **THEN** an error is shown against the email field
- **AND** the form cannot be submitted

#### Scenario: Required field left empty

- **WHEN** an administrator leaves a required field empty
- **THEN** an error is shown against that field
- **AND** the form cannot be submitted

#### Scenario: Client and server agree on validity

- **WHEN** input satisfies the shared schema client-side
- **THEN** the server does not reject it as a validation error

---

### Requirement: Theme preference persists without a flash of the wrong theme

The application SHALL offer a light and a dark theme, SHALL persist the selection in the browser, and SHALL apply the persisted selection before first paint.

#### Scenario: Theme survives a reload

- **WHEN** a user selects the dark theme and reloads the page
- **THEN** the application renders in the dark theme

#### Scenario: No flash on load

- **WHEN** a user with the dark theme persisted loads any route
- **THEN** the page does not render in the light theme at any point before the dark theme is applied

#### Scenario: Stored preference is unreadable

- **WHEN** the stored theme preference is missing or cannot be read
- **THEN** the application renders in its default theme without error
