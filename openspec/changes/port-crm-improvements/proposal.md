# Proposal

## Why

`int-crm-back` was forked from this template and, while running in production, hardened several generic pieces and added infrastructure any SaaS dashboard needs. Some of those fixes close real gaps that are still open here: `/api/auth/*` sign-in has no rate limit, and `/metrics` is left open when its token is forgotten. Porting them back now stops every new project from inheriting those gaps.

## What Changes

**Hardening**
- `apps/auth` turns on better-auth's own rate limiter in every environment except `test`. It uses strict per-path limits on the credential endpoints and keeps its counters in Redis, shared across workers. If Redis is down, requests are allowed rather than refused.
- In production, `/metrics` refuses every request when `METRICS_TOKEN` is unset.
- When request and response bodies are logged, a key is now redacted if a sensitive word appears anywhere in it, after the key is normalised (lower-cased, with `_` and `-` removed). Today only an exact key match is redacted. So `clientSecret` and `x_api_key` are now caught too.
- The seeder retries a failed run up to 3 times before giving up, which covers the cold-start `ECONNREFUSED` race.

**Mail**
- New Resend provider. `MAIL_PROVIDER` (`brevo` | `resend`) picks the provider at boot, and only that provider's API key is required. Brevo stays the default, so existing deployments keep working.
- `Mail` can now carry an `html` body. Both providers deliver it.

**Account invitation**
- **BREAKING (web):** an account created by an admin no longer gets a password from the dialog. The user receives an email inviting them to set their own password. The password-reveal step in `create-user-dialog` is removed.
- Setting that first password marks the email as verified and sends an "Account activated" email. The welcome email is no longer sent when an admin creates an account.
- A password reset for an account that never set a password sends the invitation again.

**Web push**
- Each user can opt in per browser. The VAPID public key endpoint and the subscription endpoints are open to any authenticated user.
- Delivery goes through a new `push-queue`, with retries, a DLQ and cleanup of subscriptions the push service reports as gone. The push DLQ can be inspected in Bull Board and through the DLQ API.
- The account page gets a way to send a test push to yourself. The template has no domain events of its own, so this is the only way to check push end to end.

**PWA and mobile**
- The web app can be installed: manifest, `ngsw` service worker and icons. The static shell loads offline, and API data is never cached.
- Below the mobile breakpoint, dialogs open full-screen.

**Developer tooling (no spec)**
- `.claude/CORNER_CASES.md` is split into an index plus one file per area under `.claude/corner-cases/`. The generic entries found in the CRM are imported.
- New `crud-module` skill, adapted to the `customers` reference slice.

## Capabilities

### New Capabilities
- `auth-rate-limiting`: throttling of better-auth's own `/api/auth/*` endpoints, which the Nest throttler never reaches.
- `mail-delivery`: provider selection, required credentials, HTML and text bodies, and reporting a provider rejection as a failure.
- `account-invitation`: an admin-created account is activated through an emailed set-password invitation.
- `web-push-notifications`: per-browser opt-in, reliable fan-out delivery, click-through to an in-app page, and a test push.
- `web-pwa-install`: installability, an offline static shell, and pickup of new deploys.

### Modified Capabilities
- `prometheus-metrics`: `/metrics` fails closed in production when no token is configured.
- `structured-production-logging`: sensitive keys are redacted by normalised substring.
- `scoped-database-seeding`: seeding retries transient failures.
- `dlq-management-api`: the DLQ handlers pick the queue from the payload (`email` or `push`). Bull Board shows the push queues and hides invitation links.
- `angular-web-app`: user creation no longer shows a password, and dialogs are full-screen on narrow viewports.

## Non-goals

- OAuth provider, MCP app, delegated access, multi-role accounts, the TargX design system, HTML sanitising, and `SCHEDULES`.
- Converting the existing account emails (reset, verification, 2FA) to HTML. Only the new invitation and activation emails get HTML bodies.
- Push notifications for any domain event. The template ships the channel and a test push only.
- Offline data or offline writes.
- Mobile card views, a mobile kanban and an off-canvas sidebar drawer. The template has no boards, and its sidenav is a permanent side panel (`mode="side" opened`) that this change leaves as it is; only dialogs become full-screen.

## Risks & Mitigations

- **The auth rate limiter blocks e2e or dev logins.** → It is disabled when `NODE_ENV=test`, and the limits are generous enough for normal use (10 sign-ins per minute).
- **The invitation flow depends on better-auth internals:** whether a credential account exists, and the order in which `databaseHooks` run. → Pin the behaviour with e2e tests, and record the gotchas in the auth corner cases.
- **The service worker serves `index.html` for `/api/**` navigations.** → Exclude `/api` from the navigation URLs in `ngsw-config.json`. This is a known gotcha from the CRM.
- **A single large change is hard to review.** → Each task group closes with its own commit, so the work can be reviewed group by group.

## Alternatives considered

- **Make Resend the default provider, as the CRM did.** Rejected: existing template deployments would break without a new key.
- **One push job per device.** Rejected for now: one job per notification is simpler, and the `tag` hides a duplicate sent on retry.
- **Rate-limit auth through the Nest `@RateLimit()` throttler.** Not possible: better-auth handles `/api/auth/*` outside the Nest guard pipeline.

## Open questions

None blocking. The defaults chosen here are Brevo as the default provider, a test push on the account page, and HTML for the new emails only. They are recorded in design.md.

## Impact

- **Apps:** `apps/auth` (rate limit, invitation hooks), `apps/api` (push module), `apps/worker` (mail provider, push consumer, push DLQ, Bull Board), `apps/notifications` (invitation and activation handlers), `apps/web` (PWA, push opt-in, create-user dialog, dialog sizing).
- **Packages:** `packages/shared` (metrics guard, `SanitizeUtil`, `PushProducer`, constants), `packages/shared-types` (push and invitation schemas), `packages/mail` (Resend, `html`), `packages/database` (`PushSubscription` model, seeder retry).
- **New dependencies:** `resend` (`packages/mail`), `web-push` (`apps/worker`), `@angular/service-worker` (`apps/web`).
- **New environment variables:** `MAIL_PROVIDER`, `RESEND_API_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. They are added to `.env.example`, the `env.ts` schemas and DEPLOY.md.
