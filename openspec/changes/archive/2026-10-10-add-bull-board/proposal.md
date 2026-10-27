# Proposal

## Why

The `dlq-management-api` spec already requires an admin queue dashboard at `/admin/queues` in the worker, but no code delivers it: the integration was removed in `2c87e01` and the spec was never updated. Operators have no way to see what is in `email-queue` / `email-queue-dlq`, and the DLQ alert in `apps/worker/README.md` has nothing to point at.

The spec also promises "replay via the UI", which the stock dashboard cannot do: DLQ jobs sit in `waiting` in a queue with no consumer, and the dashboard's retry only re-runs a `failed` job in its own queue. A retry on `email-queue` would additionally duplicate a job already copied to the DLQ, so the dashboard is made **read-only** and replay stays with the existing DLQ message patterns.

## What Changes

- `apps/worker`: mount Bull Board, read-only, at `/admin/queues`, showing `email-queue` and `email-queue-dlq`.
- Admin-only access with the gateway's auth semantics: no/invalid session → 401, non-admin → 403, auth service silent/unreachable → 503.
- Job data shown by the dashboard has `resetLink` and `verificationLink` redacted; other fields stay visible for diagnosis.
- `apps/worker`: trust the reverse proxy for client identity (as `apps/api` and `apps/auth` already do) and verify the dashboard renders under the default security headers (relaxing them for that path only if it does not).
- Deployment: the dashboard is reachable only through the reverse proxy, at `/admin/queues/` on the frontend's origin (`docs/deploy/nginx/frontend.conf`), with the deploy docs updated.
- **Spec correction**: the "replay via the dashboard" scenario is replaced by "the dashboard changes no job"; replay remains `DLQ_REPLAY`.
- `apps/worker/README.md`: document the dashboard again.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `dlq-management-api`: the dashboard requirement gains the 403/503 outcomes, read-only behaviour and payload redaction, and drops the UI replay scenario.
- `nginx-subdomain-topology`: the worker's dashboard is reachable through the proxy under the existing cookie and client-identity rules.

## Impact

- `apps/worker` (dashboard module, auth middleware, `main.ts` proxy/header settings, README), `packages/shared` (token validation extracted from `MicroserviceAuthGuard` so the dashboard and the guard share it).
- Dependencies: `@bull-board/api`, `@bull-board/express`, `@bull-board/nestjs` (previously `^6.10.3`, resolved `6.21.3` with `bullmq@5`); re-validate with `bullmq@6.3.x`.
- Infra: `location ^~ /admin/queues/` in the host-level `frontend.conf` (the web container's own `nginx.conf.template` is not changed); `DEPLOY.md` / `DEPLOY-PM2.md` note the exception to "the worker is not exposed".
- No audit, data model or `apps/web` changes.

## Non-goals

- Any write from the dashboard (retry, remove, clean, pause, promote, edit).
- An HTTP or UI surface for DLQ replay/purge; it stays on the `DLQ_*` message patterns (a later change may expose it, audited).
- Audit events for dashboard use: with no writes, nothing qualifies (`audit-log`: reads are not recorded).
- Dashboards in other apps; custom RBAC beyond `ADMIN`.

## Risks & Mitigations

- **Personal data still visible** (recipient emails, names) → admin-only; only the account-takeover links are redacted. Revisit if more sensitive fields are added to job inputs.
- **Redaction misses a new link field** → redaction test enumerates every job input schema in `packages/shared/src/queue/input` and fails on an unredacted `z.url()` field.
- **Default `helmet()` CSP might block the dashboard UI** → static analysis of the installed UI (task 1.2) says it fits the default CSP, so no relaxation is planned; a request-level test under the real helmet proves it, and the header is relaxed for that path only if the test fails. The cause of the earlier removal (`2c87e01`) stays unknown.
- **Read-only flag not honoured by a future dashboard version** → test that a write request against the mounted dashboard leaves the job unchanged.
- **Dashboard shares the SPA's origin** (chosen over a sibling subdomain) → its HTML is third-party UI served in the app's origin; mitigated by admin-only access, read-only mode and escaped rendering of job data. A sibling subdomain would isolate it and remains an option.
- **Auth outage** → 503, bounded by `AUTH_RPC_TIMEOUT_MS`.
- **`bullmq@6` peer drift** → `pnpm dedupe`, single `bullmq` resolution.

## Alternatives considered

- **Writable dashboard + audit middleware**: rejected; the only useful write (DLQ replay) is not available, retries risk duplicate emails, and it needs route-to-action mapping, a contract test and CSRF protection between sibling subdomains.
- **Mount in `apps/api`**: rejected; it owns no queues.
- **Hide job data entirely**: rejected; recipient and template are needed to diagnose failures.

## Open Questions

1. ~~Public hostname/path for the worker dashboard~~ — **decided:** path `/admin/queues/` on the frontend's origin, proxied by the host-level nginx. No new certificate or DNS.
2. **Throttling the dashboard**: the global throttler guards Nest routes; whether the mounted dashboard needs its own limit is undecided. Does not change the specs.
