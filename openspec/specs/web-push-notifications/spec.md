# web-push-notifications Specification

## Purpose
Lets a signed-in user receive the application's notifications as browser push on the browsers where they opted in, through one delivery channel every notification type shares, without exposing sensitive content outside the app.

## Requirements

### Requirement: A user opts in to push per browser
An authenticated user SHALL be able to enable push on the browser they are using, after the browser grants permission. The subscription SHALL be stored against that user, and a user MAY have subscriptions on several browsers. No role beyond being authenticated SHALL be required.

#### Scenario: Enabling push on a supporting browser
- **WHEN** an authenticated user enables push on their account page and grants the browser's permission
- **THEN** the browser's subscription is stored for that user
- **AND** notifications addressed to that user reach that browser

#### Scenario: Permission denied
- **WHEN** the user denies the browser's permission prompt
- **THEN** no subscription is stored and the web app shows that push is blocked in the browser settings

### Requirement: Unsupported browsers are told why push is unavailable
Where the browser cannot receive push, the web app SHALL NOT offer the option to enable it and SHALL show the reason instead.

#### Scenario: Unsupported browser
- **WHEN** the web app runs where push is unavailable (e.g. iOS without the app installed to the home screen)
- **THEN** the option to enable push is not offered and the reason is shown

### Requirement: A browser's subscription belongs to its latest subscriber
When a browser already subscribed for one user is subscribed by another user, the subscription SHALL belong only to the new user.

#### Scenario: Re-subscribing the same browser as another user
- **WHEN** a browser subscribed for user A is subscribed by user B
- **THEN** only user B receives push on that browser

### Requirement: The VAPID public key is available to authenticated clients
The system SHALL return the push public application key to any authenticated caller and SHALL refuse unauthenticated callers with 401. The private key SHALL never be returned by any endpoint.

#### Scenario: Reading the public key
- **WHEN** an authenticated caller requests the push public key
- **THEN** the public key is returned

#### Scenario: Unauthenticated caller
- **WHEN** an unauthenticated caller requests the push public key
- **THEN** the request is refused with 401

### Requirement: A user can only remove their own subscriptions
An authenticated user SHALL be able to disable push on a browser, removing its subscription. Removing a subscription that does not exist or belongs to another user SHALL succeed without removing anything.

#### Scenario: Disabling push
- **WHEN** a user disables push on their browser
- **THEN** that browser's subscription is removed and it receives no further notifications

#### Scenario: Removing another user's subscription
- **WHEN** a user asks to remove a subscription endpoint that belongs to another user
- **THEN** the response is successful and the other user's subscription is untouched

### Requirement: Signing out removes the browser's subscription
Signing out of the web app SHALL remove the current browser's subscription. A failure to remove it SHALL NOT prevent the sign-out.

#### Scenario: Signing out
- **WHEN** a user with push enabled signs out on a browser
- **THEN** that browser's subscription is removed
- **AND** the next user of that browser receives none of the previous user's notifications

#### Scenario: Removal fails during sign-out
- **WHEN** removing the subscription fails while a user signs out
- **THEN** the user is still signed out

### Requirement: Push is delivered to every live subscription of the recipients
A push notification SHALL be delivered to every live subscription of each addressed user. A user with no live subscription SHALL receive no push, and that SHALL NOT be an error.

#### Scenario: A user with two browsers
- **WHEN** a notification is addressed to a user subscribed on two browsers
- **THEN** both browsers receive it

#### Scenario: Recipient without subscriptions
- **WHEN** a notification is addressed to a user with no live subscription
- **THEN** nothing is sent and no failure is recorded

### Requirement: Failed push deliveries are retried and dead-lettered
A transient delivery failure SHALL be retried. A notification still failing after its retries SHALL be kept in the push dead-letter queue for inspection and replay. A push failure SHALL NOT affect any email for the same event.

#### Scenario: Transient failure
- **WHEN** the push service fails temporarily on every attempt
- **THEN** delivery is retried, and after the last failed attempt the notification is held in the push dead-letter queue

### Requirement: Gone subscriptions are removed
A subscription the push service reports as no longer existing SHALL be removed and SHALL NOT be retried, while the notification is still delivered to the user's other subscriptions.

#### Scenario: Expired subscription
- **WHEN** the push service answers that one of a user's two subscriptions no longer exists
- **THEN** that subscription is removed
- **AND** the notification is still delivered to the other subscription

### Requirement: A push opens its in-app destination when clicked
Every push SHALL carry a title, a body and an in-app destination path. Clicking it SHALL focus the web app, or open it, at that destination. A push MAY carry a tag; a new push with the same tag SHALL replace the previous one on the device.

#### Scenario: Clicking a notification
- **WHEN** the user clicks a push whose destination is `/customers/<id>`
- **THEN** the web app opens at that page, behind the normal sign-in

#### Scenario: Same tag replaces
- **WHEN** a second push with the same tag reaches a device still showing the first
- **THEN** only the second is shown

#### Scenario: Absolute destination is rejected
- **WHEN** a push is enqueued with an absolute URL such as `https://evil.example/` as its destination
- **THEN** it is rejected before being queued

### Requirement: Push content carries no personal detail beyond a name
A push title and body SHALL NOT contain personal or sensitive data other than a person's name. The destination SHALL identify a record only by its id; all other detail SHALL be visible only after opening it in an authenticated session.

#### Scenario: Notification about a customer
- **WHEN** a push about a customer is sent
- **THEN** it may name the customer but its destination identifies the customer only by id

### Requirement: A user can send a test push to themselves
An authenticated user SHALL be able to send a test push to their own subscriptions from the account page. The test push SHALL be delivered through the same channel as any other push.

#### Scenario: Test push
- **WHEN** a user with push enabled sends a test push
- **THEN** each of their subscribed browsers shows the test notification
- **AND** clicking it opens the account page

#### Scenario: Test push without subscriptions
- **WHEN** a user without any subscription sends a test push
- **THEN** the request succeeds and nothing is shown on any device
