# Nginx Subdomain Topology

## Purpose

Defines how a browser reaches the services and how the session cookie is scoped, now that the frontend is a static bundle with no server of its own. It covers the split between the frontend's same-origin API and the separately-hosted authentication service, the cookie scope that gives single sign-on across sibling applications, and the origin allowlists that must agree with both.

## Requirements

### Requirement: The frontend's own API is reached same-origin

Requests from the frontend to its own backend API SHALL be issued to the path prefix `/api/` on the frontend's own origin, and SHALL be routed to the backend API service. The frontend SHALL NOT require an absolute host for its own API, and these requests SHALL NOT be subject to cross-origin restrictions.

#### Scenario: Business API call is same-origin

- **WHEN** the frontend requests its own API
- **THEN** the request is issued to `/api/…` on the origin the page was served from
- **AND** no CORS preflight is performed

#### Scenario: The path never repeats the application name

- **WHEN** a route to the frontend's own API is defined
- **THEN** the path is `/api/<resource>` and does not include the application's name

---

### Requirement: The authentication service is a separate origin on a sibling subdomain

The authentication service SHALL be served from its own hostname, sharing a registrable parent domain with the frontend, under the path prefix `/api/auth/`. The frontend SHALL address it by absolute origin. Because the two hostnames share a registrable domain, requests between them SHALL remain same-site.

#### Scenario: Auth call is cross-origin but same-site

- **WHEN** the frontend calls the authentication service
- **THEN** the request targets the authentication service's own origin
- **AND** the session cookie is sent with the request

#### Scenario: Credentialed request carries cookies

- **WHEN** the frontend issues any authentication or user-management request
- **THEN** the request includes credentials
- **AND** the server receives the session cookie

---

### Requirement: The session cookie is shared across sibling subdomains

The session cookie SHALL be scoped to the narrowest parent domain shared by the applications that must share a session, so that signing in on one sibling application authenticates the user on the others. The cookie SHALL retain `SameSite=Lax`, `HttpOnly`, and — when served over HTTPS — the `Secure` attribute and its corresponding name prefix. `SameSite=None` SHALL NOT be used.

#### Scenario: Single sign-on across siblings

- **WHEN** a user signs in on one application and then opens a sibling application on the same parent domain
- **THEN** the user is already authenticated
- **AND** no second sign-in is required

#### Scenario: Cookie attributes over HTTPS

- **WHEN** the authentication service issues a session cookie over HTTPS
- **THEN** the cookie is `HttpOnly`, `Secure`, `SameSite=Lax`
- **AND** its `Domain` is the configured shared parent domain

#### Scenario: Secure attribute follows the public origin

- **WHEN** the authentication service's configured public base URL uses `https`
- **THEN** the issued session cookie carries the `Secure` attribute and the secure name prefix

#### Scenario: Both cookie name forms are accepted

- **WHEN** a request arrives carrying the session token under either the plain or the secure-prefixed cookie name
- **THEN** the backend resolves the session from it

#### Scenario: Cookie scope is not widened beyond what is shared

- **WHEN** the shared cookie domain is configured
- **THEN** it is the narrowest parent domain covering the applications that must share the session

---

### Requirement: Deep links and reloads resolve to the application

For the frontend origin, any request path that does not match a static asset and is not under `/api/` SHALL return the application entry document, so that client-side routes remain valid on direct navigation and on reload.

#### Scenario: Reload on a nested route

- **WHEN** a browser requests a nested application route directly
- **THEN** the application entry document is returned with a success status
- **AND** the client-side router renders the requested route

#### Scenario: API paths are not captured by the fallback

- **WHEN** a request is made to `/api/…` on the frontend origin
- **THEN** it is routed to the backend API
- **AND** it does not return the application entry document

#### Scenario: Missing static asset

- **WHEN** a request is made for a static asset that does not exist
- **THEN** the response does not silently return the application entry document in place of the asset

---

### Requirement: The CORS allowlist reflects exactly one matched origin

The authentication service SHALL accept credentialed cross-origin requests only from an explicit allowlist of browser origins. Its `Access-Control-Allow-Origin` response header SHALL contain exactly one origin — the request's origin, when allowed. A comma-joined multi-origin value SHALL NOT be emitted, and a wildcard SHALL NOT be emitted for credentialed requests.

#### Scenario: Allowed origin is reflected

- **WHEN** a credentialed request arrives from an allowlisted origin
- **THEN** `Access-Control-Allow-Origin` contains exactly that origin
- **AND** `Access-Control-Allow-Credentials` is `true`

#### Scenario: Multiple configured origins

- **WHEN** more than one browser origin is configured
- **THEN** each of them is accepted individually
- **AND** the response header never lists more than one origin

#### Scenario: Disallowed origin

- **WHEN** a credentialed request arrives from an origin that is not allowlisted
- **THEN** the response does not grant that origin access

---

### Requirement: Trusted origins list browser origins and never a bare wildcard

The authentication service SHALL validate the request `Origin` against a list of trusted browser origins, which also governs which redirect and callback targets are permitted. The list SHALL contain the origins the browser actually uses, not the service's own origin. A bare wildcard entry SHALL NOT be accepted into the list.

#### Scenario: Request from a trusted browser origin

- **WHEN** an authenticated request arrives from a trusted browser origin
- **THEN** it is processed normally

#### Scenario: Request from an untrusted origin

- **WHEN** an authenticated request arrives from an origin absent from the list
- **THEN** it is rejected as forbidden

#### Scenario: Wildcard entry is discarded

- **WHEN** the configured origin list contains a bare wildcard entry
- **THEN** that entry is removed before the trusted-origin list is built
- **AND** the wildcard does not cause arbitrary origins to be trusted

#### Scenario: Origin validation is exercised by tests

- **WHEN** the authentication service's end-to-end suite runs
- **THEN** at least one case sends an explicit `Origin` header
- **AND** a request from an untrusted origin is asserted to be rejected

---

### Requirement: Local development exercises the same cross-origin authentication path

Local development SHALL reach the authentication service cross-origin, as deployed environments do, rather than proxying it to the frontend's own origin. The frontend's own API MAY be proxied to the frontend origin locally, mirroring the deployed routing. A missing or incorrect origin allowlist SHALL therefore cause a local failure.

#### Scenario: Local auth call is cross-origin

- **WHEN** the developer runs the frontend and the authentication service locally
- **THEN** authentication requests target the authentication service's own origin and port

#### Scenario: Local API call is same-origin

- **WHEN** the frontend requests its own API in local development
- **THEN** the request is issued to `/api/…` on the frontend's development origin
- **AND** it is forwarded to the locally running backend API

#### Scenario: Broken allowlist fails locally

- **WHEN** the local development origin is absent from the authentication service's allowlist
- **THEN** signing in locally fails
- **AND** the failure is observable without deploying

---

### Requirement: Client identity is derived correctly behind the proxy

Every backend service exposed through the reverse proxy SHALL derive the client's address from the proxy's forwarded headers rather than from the immediate connection, so that per-client rate limiting and request logs attribute requests to the real caller.

#### Scenario: Rate limiting distinguishes clients

- **WHEN** two different clients issue requests through the proxy
- **THEN** per-client rate limits are applied to each client independently
- **AND** not to the proxy as a single client

#### Scenario: Logged client address

- **WHEN** a request arrives through the proxy
- **THEN** the logged client address is the originating client's, not the proxy's
