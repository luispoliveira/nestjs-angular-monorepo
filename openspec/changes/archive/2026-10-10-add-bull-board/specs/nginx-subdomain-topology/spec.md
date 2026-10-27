## ADDED Requirements

### Requirement: The queue dashboard is reached through the reverse proxy
The worker's queue dashboard SHALL be reachable by browsers only through the reverse proxy, at the path `/admin/queues/` on the frontend's origin, under the same session cookie and forwarded-client-address rules as the other proxied services. The worker's own port SHALL NOT be exposed publicly.

#### Scenario: Admin session is accepted by the dashboard
- **WHEN** an admin signed in through the authentication service opens the dashboard through the proxy
- **THEN** the session cookie is sent and the dashboard authenticates the request

#### Scenario: Only the proxy's forwarded address is trusted
- **WHEN** a request reaches the worker through the proxy carrying a client-supplied `X-Forwarded-For` entry
- **THEN** the worker takes the client address from the entry the proxy appended (counted from the right by the trusted-hop count), never from the first entry

#### Scenario: Worker is not directly reachable
- **WHEN** a browser requests the worker's port directly from outside the deployment network
- **THEN** the connection is refused

#### Scenario: The dashboard's assets are not claimed by the frontend's static rule
- **WHEN** a browser requests a script or stylesheet under `/admin/queues/` on the frontend origin
- **THEN** the request is routed to the worker and is not answered from the frontend's static files

#### Scenario: Frontend routing is unaffected
- **WHEN** a browser requests a missing static asset or a client-side route outside `/admin/queues/` and `/api/`
- **THEN** it receives the same responses as before the dashboard was added
