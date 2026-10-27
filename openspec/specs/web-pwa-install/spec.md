# web-pwa-install Specification

## Purpose
Defines what makes the web dashboard installable as an app, what keeps loading when briefly offline, and how a new deploy replaces the cached version.

## Requirements

### Requirement: The application is installable
The web app SHALL expose a valid manifest declaring its name, a standalone display mode, a start URL, and icons at 192×192 and 512×512 (including maskable variants), and SHALL register a service worker in production builds, so supporting browsers offer to install it.

#### Scenario: Browser offers to install the app
- **WHEN** a user opens the production build in a browser that supports installation
- **THEN** the browser's installability criteria are met
- **AND** the user is offered an install / add-to-home-screen action

#### Scenario: Installed app opens in its own window
- **WHEN** a user launches the installed app
- **THEN** it opens in a standalone window without the browser's address bar

#### Scenario: Development build
- **WHEN** the web app runs through the development server
- **THEN** no service worker is registered

### Requirement: App icons are replaceable in one place
The favicon, the install icons and the manifest's icon entries SHALL all be served from one icons directory in the web app, so a project replaces the template's placeholder mark by swapping those files only.

#### Scenario: Replacing the icons
- **WHEN** a project replaces the files in the icons directory with its own mark
- **THEN** the browser tab, the home-screen icon and the install prompt all show the new mark

### Requirement: The static shell loads after a brief loss of connectivity
Once loaded, the app's static shell (scripts, styles, fonts, icons) SHALL load on a later visit without connectivity instead of the browser's offline page.

#### Scenario: Reopening the app while offline
- **WHEN** a user who loaded the app online reopens it while offline
- **THEN** the shell (navigation, layout, static assets) renders
- **AND** the browser's own offline page is not shown

### Requirement: API data is never served from the service worker
Requests under `/api/` SHALL never be answered from the service-worker cache, and a navigation to an `/api/` path SHALL reach the server instead of receiving the app's `index.html`.

#### Scenario: Data while offline
- **WHEN** a user is offline and the shell has rendered
- **THEN** screens that need data behave as they do today when a request fails
- **AND** no previously cached data is presented as current

#### Scenario: Navigating to an API path
- **WHEN** the browser navigates directly to an `/api/` URL with the service worker active
- **THEN** the response comes from the server, not the cached `index.html`

### Requirement: A new deploy replaces the cached shell
When a new version is deployed, a user with the previous version cached SHALL get the new version on a later visit without clearing their cache.

#### Scenario: Picking up a new deploy
- **WHEN** a new version has been deployed and a user reopens the app after it checked for updates
- **THEN** the new version is the one that loads
