# Tasks

## 1. Hardening: metrics, log redaction, seeder, auth rate limit

- [x] 1.1 test: packages/shared: extend `metrics-auth.guard.spec.ts` with the "closed in production without token" and "open outside production without token" scenarios. Verify the new cases fail.
- [x] 1.2 fix: packages/shared: make `MetricsAuthGuard` fail closed when `NODE_ENV=production` and there is no token (D2). Verify `pnpm --filter @repo/shared test` passes.
- [x] 1.3 test: packages/shared: extend `sanitize.util.spec.ts` with the compound-key, nested-key and ordinary-key scenarios (`clientSecret`, `x_api_key`, `refresh-token`, nested `newPassword`, `name`/`email`). Verify the new cases fail.
- [x] 1.4 fix: packages/shared: switch `SanitizeUtil` to normalised-substring matching and collapse `SENSITIVE_KEYS`, keeping `taxid` and the query redaction (D3). Verify the sanitize and PII redaction specs pass.
- [x] 1.5 test: packages/database: add seeder specs for "fails once, then succeeds" (one warning logged), "fails 3 times" (rethrows), and a retried run creating no duplicates. Verify they fail.
- [x] 1.6 fix: packages/database: add `withRetry` around the seeding run and confirm every step is idempotent (D4). Verify `pnpm --filter @repo/database test` passes.
- [x] 1.7 test: apps/auth: port `rate-limit.storage.spec.ts`: within the limit, over the limit with `retryAfter`, TTL set only on the first hit, fail open on a Redis error. Verify it fails.
- [x] 1.8 feat: apps/auth: add `rate-limit.storage.ts` and the better-auth `rateLimit` config with `customRules`, disabled when `NODE_ENV=test` (D1). Verify the storage spec passes, then run `pnpm dev` and confirm the 11th `/sign-in/email` within a minute returns 429 with `X-Retry-After`.
- [x] 1.9 docs: .claude: add corner cases for "the global throttler does not cover `/api/auth/*`" and the cold-start seeder retry. Note in DEPLOY.md that `METRICS_TOKEN` is required in production. Verify both files mention them.
- [x] 1.10 chore: commit group 1 with `/commit`. Verify build, lint, check-types and tests pass in the gate.

## 2. Mail: Resend provider and HTML body

- [x] 2.1 test: packages/mail: port `resend.provider.spec.ts` (sender format, html/text/cc/bcc/attachments mapping, throws on an `{ error }` result). Extend `brevo.provider.spec.ts` (sends `htmlContent`) and `mail.service.spec.ts` (provider chosen from options, unknown provider throws). Verify they fail.
- [x] 2.2 feat: packages/mail: add `html` to `Mail`, add `ResendProvider`, map `htmlContent` in Brevo, and resolve the provider by factory from `MAIL_MODULE_OPTIONS` (`'brevo' | 'resend'`, sendgrid stub removed). Add the `resend` dependency (D5). Verify `pnpm --filter @repo/mail test` passes.
- [x] 2.3 test: apps/worker: extend `env.spec.ts`: `MAIL_PROVIDER` defaults to brevo, rejects unknown values, and requires only the active provider's key. Verify it fails.
- [x] 2.4 feat: apps/worker: add `MAIL_PROVIDER`, `RESEND_API_KEY` and the conditional key requirement to `env.ts`, and pass the provider into `MailModule.forRootAsync`. Verify the env spec passes and the worker boots with `MAIL_PROVIDER=resend` and no Brevo key.
- [x] 2.5 docs: update `.env.example`, `apps/worker/.env.example`, DEPLOY.md and README with `MAIL_PROVIDER`/`RESEND_API_KEY`. Verify the documented variables match `env.ts`.
- [x] 2.6 chore: commit group 2 with `/commit`. Verify the gate passes.

## 3. Account invitation

- [x] 3.1 test: apps/auth: extend `local-auth.service.spec.ts` so the change-password, set-password and 2FA enable/disable after-hooks emit nothing when `ctx.context.returned` is an `Error`. Verify it fails.
- [x] 3.2 fix: apps/auth: add the `isRefused(ctx)` guard to every notifying `@AfterHook` (D6). Verify the spec passes.
- [x] 3.3 test: packages/shared: add schema specs for the invitation and activation payloads, and publisher specs for `emitUserInvited`/`emitUserAccountActivated`. Verify they fail.
- [x] 3.4 feat: packages/shared: add `USER_INVITED`, `USER_ACCOUNT_ACTIVATED`, `SEND_ACCOUNT_INVITATION_EMAIL` and `SEND_ACCOUNT_ACTIVATED_EMAIL`, the schemas, publisher methods and producer methods. Add `invitationLink` to `redactJobData`. Verify the specs pass and `redact-job-data` redacts `invitationLink`.
- [x] 3.5 test: packages/mail: specs for `account-emails.ts`: subject, html and text for the invitation and activation emails, the link present in full in the text body, HTML escaping, and no password. Verify they fail.
- [x] 3.6 feat: packages/mail: add the minimal `account-emails.ts` templates (D6). Verify the specs pass.
- [x] 3.7 test: apps/notifications + apps/worker: specs for the event handlers enqueuing the new jobs, and for `EmailConsumer` sending each rendered email. Verify they fail.
- [x] 3.8 feat: apps/notifications + apps/worker: add the handlers and the consumer branches. Verify the specs pass.
- [x] 3.9 test: apps/auth: port `account-emails.e2e-spec.ts`. Cover: admin create gives one invitation and no welcome email; the seeded admin and social sign-in get no invitation; set password gives verified, activated and sign-in works; a reset for a never-activated account re-sends the invitation; an unknown email sends nothing. Verify it fails.
- [x] 3.10 feat: apps/auth: bind `auth` to a `const`; in the `user.create.after` hook, request a reset on `/admin/create-user` and skip `USER_CREATED`; branch `sendResetPassword` on the credential account; mark the account verified and activated in `onPasswordReset` (D6). Make `test:e2e` run with `--runInBand`. Verify `pnpm --filter auth test:e2e` passes.
- [x] 3.11 test: apps/web: update `create-user-dialog.spec.ts`: `createUser` is called without a password, no reveal step, success message says invitation sent. Verify it fails.
- [x] 3.12 feat(web)!: apps/web: remove the password generator and reveal step from `create-user-dialog`. Verify the spec passes and `pnpm --filter web build` succeeds.
- [x] 3.13 docs: .claude/README: corner cases for `admin.createUser` sending no email, `onPasswordReset` seeing the pre-reset user, and `@AfterHook` running on refused requests. Update the README auth section. Verify the entries exist.
- [x] 3.14 chore: commit group 3 with `/commit`, using a `BREAKING CHANGE:` footer for the web dialog. Verify the gate passes.

## 4. PWA

- [ ] 4.1 test: apps/web: spec that `app.config` provides the service worker only when not in dev mode, and a spec that reads `ngsw-config.json` and asserts there are no `dataGroups` and that `navigationUrls` excludes `/api/**`. Verify they fail.
- [ ] 4.2 feat: apps/web: add `@angular/service-worker`, `ngsw-config.json`, `manifest.webmanifest`, `public/icons/*` (neutral placeholder mark) and the `index.html` links (D8). Verify the specs pass and the production build emits `ngsw-worker.js`.
- [ ] 4.3 build: apps/web: make nginx serve `ngsw-worker.js` and `ngsw.json` with `Cache-Control: no-cache`. Verify with `curl -I` against the built container.
- [ ] 4.4 docs: README/DEPLOY.md: how to replace the icons and the no-cache requirement. Add the "SW serves index.html for `/api/**`" corner case. Verify the docs mention them.
- [ ] 4.5 chore: commit group 4 with `/commit`. Verify the gate passes.

## 5. Web push: backend

- [ ] 5.1 feat: packages/database: add the `PushSubscription` model and the `User` back-relation, then generate the migration (D7). Verify `pnpm db:generate` and the migration apply on a clean database.
- [ ] 5.2 test: packages/shared-types + packages/shared: `sendPushNotificationSchema` specs (relative `url` only, `//` rejected, at least one user id) and `PushProducer` specs (parses before enqueueing, uses `SEND_PUSH_NOTIFICATION`). Extend the `QueueModule`/constants specs for `PUSH`/`PUSH_DLQ`. Verify they fail.
- [ ] 5.3 feat: packages/shared-types + packages/shared: add the schema, `QUEUES.PUSH`/`PUSH_DLQ`, `JOB_PATTERNS.SEND_PUSH_NOTIFICATION` and `PushProducer`. Verify the specs pass.
- [ ] 5.4 test: apps/worker: port `push.consumer.spec.ts`: fan-out to every live subscription, soft-delete on 404/410, `AggregateError` on other failures, no-op without subscriptions, `ngswPayload` shape, routing to the DLQ after the last attempt. Verify it fails.
- [ ] 5.5 feat: apps/worker: add `PushConsumer`, `PushDlqService`, the VAPID env vars and the `web-push` dependency, and register the push queues. Verify the spec passes and the worker boots.
- [ ] 5.6 test: apps/worker: extend the `dlq.controller` spec (dispatch by `payload.queue`, unknown queue gives an error) and the Bull Board spec (push queues listed). Verify they fail.
- [ ] 5.7 feat: apps/worker: route `DlqController` by queue and add the push queues to Bull Board. Verify the specs pass.
- [ ] 5.8 test: apps/api: push e2e: public key (200 / 401), subscribe and reassign to the latest user, delete own vs another user's (204 and untouched), test push enqueues a job addressed only to the caller. Verify it fails.
- [ ] 5.9 feat: apps/api: add the push module (controller, service, DTOs, `@RateLimit('default')`) and `VAPID_PUBLIC_KEY` in `env.ts`. Verify the e2e passes.
- [ ] 5.10 docs: `.env.example`/DEPLOY.md (VAPID keys, `npx web-push generate-vapid-keys`). Port the push skill to `.claude/skills/push-notification/SKILL.md`, adapted to the template and including the content rule. Add a database corner case on the `auth.prisma` back-relation. Verify the files exist.
- [ ] 5.11 chore: commit group 5 with `/commit`. Verify the gate passes.

## 6. Web push: web

- [ ] 6.1 test: apps/web: `PushService` specs (unsupported → reason shown, denied → blocked message, enable subscribes and POSTs, disable unsubscribes and DELETEs) and an account-page spec for the push card and the test button. Verify they fail.
- [ ] 6.2 feat: apps/web: add `PushService` and the push card on the account page. Verify the specs pass.
- [ ] 6.3 test: apps/web: sign-out spec: unsubscribes before `signOut`, and still signs out when unsubscribing fails. Verify it fails.
- [ ] 6.4 feat: apps/web: unsubscribe best-effort on sign-out. Verify the spec passes.
- [ ] 6.5 docs: .claude: corner case "`ngsw` only shows a push wrapped in `notification` and opens its URL via `data.onActionClick`". Verify the entry exists.
- [ ] 6.6 chore: commit group 6 with `/commit`. Verify the gate passes.

## 7. Mobile dialogs

- [ ] 7.1 test: apps/web: spec that a dialog opened with the global defaults gets the full-screen panel class or styles below the breakpoint and keeps its usual width above it. Verify it fails.
- [ ] 7.2 feat: apps/web: add the global dialog defaults and the breakpoint CSS rule (D9). Verify the spec passes, then check the create-user dialog in Chrome at 375px and at 1280px.
- [ ] 7.3 chore: commit group 7 with `/commit`. Verify the gate passes.

## 8. Developer tooling

- [ ] 8.1 chore: .claude: split `CORNER_CASES.md` into an index plus `corner-cases/{angular,auth,database,deploy-build,nestjs,queues,testing,zod}.md`, moving the existing entries without loss. Verify the total entry count before and after matches.
- [ ] 8.2 chore: .claude: import the CRM's generic corner cases not already present, leaving out the domain-specific ones (RH, time, MCP, TargX). Verify each imported entry names only template code paths.
- [ ] 8.3 chore: .claude: port the `crud-module` skill, adapted to `customers`, cuid ids and template paths. Update the CLAUDE.md "Corner Cases Memory" section. Verify that every path the skill references exists.
- [ ] 8.4 chore: commit group 8 with `/commit`. Verify the gate passes.

## 9. Integration verification

- [ ] 9.1 Run `/verify` end to end:
  - admin creates a user; the invitation email arrives (dev redirect); the user sets a password, gets the activated email and signs in;
  - the 11th sign-in within a minute gets 429;
  - `/metrics` returns 401 with `NODE_ENV=production` and no token;
  - enabling push on the account page and sending a test push shows the notification, and clicking it opens `/account`;
  - signing out removes the subscription;
  - the production build is installable, and reloading offline renders the shell;
  - Bull Board lists all four queues with links redacted.
  Verify each check is recorded in the verify output.
- [ ] 9.2 Run `openspec validate port-crm-improvements --strict` and `pnpm build && pnpm test`. Verify both pass.
