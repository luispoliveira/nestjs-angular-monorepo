# Design

## Context

See proposal.md for why. All of the code being ported already runs in production in `int-crm-back`. The template has since diverged in a few places it must stay compatible with:

- The template already has an audit log, Bull Board with job-data redaction (`packages/shared/src/queue/input/redact-job-data.ts`), redaction of `search` in query strings, Sentry, and Loki.
- The template's mail options type is `provider: 'brevo' | 'sendgrid'`, and `sendgrid` throws `NotImplementedException`. Its emails are text-only.
- In the template, the admin create-user dialog generates a password client-side and shows it to the admin.
- In the template's `LocalAuthService`, the `@AfterHook`s (`/change-password`, `/two-factor/*`, `/admin/set-user-password`) notify without checking whether better-auth refused the request.
- The template's DLQ controller ignores `payload.queue` and always uses `EmailDlqService`.
- Template models use `String @id @default(cuid())` (the CRM uses `Int`).

## Goals / Non-Goals

**Goals:** port the CRM's behaviour with as little new code as possible, reusing the template's own abstractions (`BaseProducer`, `BaseDlqService`, `QueueModule`, `redactJobData`, `SharedModule`).

**Non-Goals:** reworking the existing account emails into HTML, notification preferences per user, and domain push events (see proposal.md, Non-goals).

## Decisions

### D1. Auth rate limit uses better-auth `rateLimit` with a Redis `customStorage` (apps/auth)
`betterAuth({ rateLimit: { enabled: NODE_ENV !== 'test', window: 60, max: 100, customRules, customStorage } })`.
- **`customStorage`:** copied from the CRM's `rate-limit.storage.ts`. It runs one Lua script that does `INCR`, sets `EXPIRE` on the first hit and reads the `TTL`, all in a single round trip, so a key can never be left without an expiry. Keys are prefixed `rl:`. If Redis fails, the request is allowed.
- **Redis client:** a dedicated `ioredis` client built from `REDIS_HOST`, `REDIS_PORT` and `REDIS_PASSWORD`. `ioredis` is already installed through BullMQ; the task checks that `apps/auth` declares it.
- **Custom rules:** `/sign-in/email` 10, `/sign-up/email` 5, `/two-factor/verify-totp` 10, `/two-factor/verify-backup-code` 10, `/request-password-reset` 3, `/reset-password` 5. The CRM also listed `/forget-password`, which better-auth 1.7.6 no longer exposes, so it is left out. The 429 carries `X-Retry-After` (not `Retry-After`) in this version.
- **Why not the Nest throttler:** better-auth handles `/api/auth/*` outside the guard pipeline, so it cannot apply.
- **Alternative rejected:** better-auth's default in-memory storage. It keeps a separate counter in each PM2 worker and is only active in production.

### D2. `/metrics` fails closed (packages/shared)
In `MetricsAuthGuard`, when there is no token, return `NODE_ENV !== 'production'`. This adds no new configuration.

### D3. SanitizeUtil matches by normalised substring (packages/shared)
- A key is normalised by lower-casing it and stripping `_` and `-`. It is redacted if the normalised key contains any normalised entry of `SENSITIVE_KEYS`.
- This lets the list shrink: `accesstoken`, `access_token` and `refreshtoken` are all covered by `token`, and `x-api-key` becomes `apikey`.
- Keep `taxid` and the template's `SENSITIVE_QUERY_PARAMS` and URL redaction exactly as they are. The CRM's health-data keys (`reason`, `decisionnote`) are domain-specific and are not ported.
- **Accepted false positive:** a key such as `tokenCount` is now redacted. In logs that is the safe direction to err in.

### D4. The seeder retries the whole run (packages/database)
`withRetry(fn, attempts = 3)` waits `attempt × 500 ms` between attempts and re-throws after the last one. Retrying the whole run is safe because every step is find-or-create on a natural key. The task checks that the template's seeder already behaves that way.

### D5. Mail provider is chosen at runtime (packages/mail, apps/worker)
- `MailModuleOptions.provider` becomes `'brevo' | 'resend'`. The `sendgrid` stub is removed.
- The `'MailProvider'` provider becomes a `useFactory` that reads `MAIL_MODULE_OPTIONS`, so the provider comes from validated config rather than being fixed when the module is defined. This is the CRM's design.
- `MailModuleAsyncOptions` no longer takes a top-level `provider`; the provider is part of the factory's result.
- **`ResendProvider`:** throws when the SDK returns `{ error }` instead of throwing, so retries and the DLQ still fire.
- **`BrevoProvider`:** sets `htmlContent` when `mail.html` is present.
- **Worker `env.ts`:** `MAIL_PROVIDER` is `z.enum(['brevo','resend']).default('brevo')`. A `superRefine` requires the key that belongs to the active provider.
- **New dependency:** `resend`, in `packages/mail`.

### D6. Invitation flow (apps/auth, packages/shared, apps/notifications, apps/worker, packages/mail)
- **Hook:** `databaseHooks.user.create.after` (it already exists and emits `USER_CREATED`). When `context?.path === '/admin/create-user'`, it calls `auth.api.requestPasswordReset({ body: { email, redirectTo } })` and does not emit `USER_CREATED`, so no welcome email is queued.
- **Binding `auth`:** the `auth` instance must be bound to a `const` before the options object closes over it, as the CRM does.
- **`sendResetPassword`:** looks up a `credential` account for the user. With none, it emits `USER_INVITED` carrying `invitationLink`. With one, it emits `USER_PASSWORD_RESET_REQUESTED` as today.
- **`onPasswordReset`:** the user object it receives is the row loaded *before* the reset. When `!user.emailVerified`, it sets `emailVerified = true` and emits `USER_ACCOUNT_ACTIVATED` instead of `USER_PASSWORD_CHANGED`.
- **Activation trigger:** activation is detected in `onPasswordReset`, not `afterEmailVerification`, because the latter also fires when a user changes their email.
- **New constants:** `EVENT_PATTERNS.USER_INVITED` and `USER_ACCOUNT_ACTIVATED`; `JOB_PATTERNS.SEND_ACCOUNT_INVITATION_EMAIL` and `SEND_ACCOUNT_ACTIVATED_EMAIL`. Zod payload schemas for both go beside the existing ones in `packages/shared/src/{publishers,queue}/input/` (that is where this template keeps event and job inputs).
- **Bull Board:** `redactJobData` also redacts `invitationLink`.
- **Templates:** `packages/mail/src/templates/account-emails.ts` is a minimal version of the CRM's `layout` + `escapeHtml`, with neutral colours and only `paragraph` and `button` blocks. It renders `{ subject, html, text }` for the invitation and activation emails only.
- **Refused `@AfterHook`s:** add a small `isRefused(ctx)` check (`ctx.context?.returned instanceof Error`) at the top of every notifying `@AfterHook` in `LocalAuthService`, so one fix covers every caller.
- **Web:** `create-user-dialog` calls `admin.createUser` without `password`. The password-reveal step and its generator are deleted, and the snackbar says "Invitation sent".
- **Redirect target:** the template has no `/forgot-password` route; the reset request lives on the sign-in page. Emails say "request a new link from the sign-in page".
- **Auth/authorization:** no change. `admin.createUser` is still admin-only, and the hook acts only on that path.

### D7. Web push (packages/database, packages/shared, apps/api, apps/worker, apps/web)
- **Data model** (`packages/database/prisma/schema.prisma`), using template conventions:
  ```prisma
  model PushSubscription {
    id        String    @id @default(cuid())
    createdAt DateTime  @default(now())
    updatedAt DateTime  @updatedAt
    deletedAt DateTime?
    userId    String
    user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
    endpoint  String    @unique
    p256dh    String
    auth      String
    userAgent String?
    @@index([userId])
    @@map("push_subscription")
  }
  ```
  - This needs a back-relation on `User`, which lives in `auth.prisma`. Template rule: "do not modify auth.prisma". Adding a relation field is the minimal exception, and the CRM did the same. Alternative: drop the Prisma relation and keep a plain `userId` with an FK created in raw SQL. Rejected, because the cascade delete when a user is removed is the behaviour we want.
- **Constants:** `QUEUES.PUSH = 'push-queue'`, `QUEUES.PUSH_DLQ = 'push-queue-dlq'`, `JOB_PATTERNS.SEND_PUSH_NOTIFICATION`.
- **Job payload:** `sendPushNotificationSchema` in shared-types: `{ userIds: string[] (min 1), title, body, url, tag? }`. `url` must be a relative path starting with `/` and not with `//`.
- **Producer:** `PushProducer extends BaseProducer`, with a single `send(payload)` that parses the payload before enqueuing it. It is the one producer for every push type, so a new type needs no new job pattern.
- **Consumer (apps/worker):** `PushConsumer`, ported from the CRM. One job delivers to all of its recipients' subscriptions with `Promise.allSettled`. Subscriptions answering 404/410 are soft-deleted. Any other failure throws an `AggregateError`, so the job is retried. After the last attempt the job goes to the push DLQ, exactly as the email consumer does. The consumer records the same metrics and Sentry events as `EmailConsumer`.
- **Notification payload:** the push body uses the `ngsw` format, `{ notification: { title, body, icon, tag?, renotify, data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } } } }`.
- **Delivery semantics:** a retry re-sends to devices that already received the push. The `tag` makes that invisible. Moving to one job per device is the upgrade path if duplicates ever appear.
- **DLQ:** `PushDlqService extends BaseDlqService`. `DlqController` picks the service from `payload.queue` with a two-entry map and returns an error for any other queue name. Bull Board registers both push queues.
- **Push module (apps/api):** authenticated, no `@Roles`:
  - `GET /push/public-key` returns `{ publicKey }`.
  - `POST /push/subscriptions` upserts by `endpoint` and reassigns it to the caller (204).
  - `DELETE /push/subscriptions` with body `{ endpoint }` soft-deletes it only if the caller owns it, and returns 204 either way.
  - `POST /push/test` calls `PushProducer.send({ userIds:[me], title, body, url:'/account', tag:'test' })` (202).
  - Every endpoint gets `@RateLimit('default')`.
- **Web (apps/web):**
  - A `PushService` wraps `SwPush` and handles support detection (`SwPush.isEnabled`, `Notification.permission`).
  - The account page gets a "Push notifications" card with enable/disable and "Send test".
  - Sign-out unsubscribes best-effort before calling `signOut`.
- **New environment variables:** `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` in the api (public key only) and the worker (all three). DEPLOY.md documents `npx web-push generate-vapid-keys`.
- **New dependency:** `web-push`, plus `@types/web-push`, in `apps/worker`.
- **Content rule:** callers must keep sensitive detail out of title and body (see the spec). Enforced by review and documented in the push skill.

### D8. PWA (apps/web)
- **Setup:** add `@angular/service-worker` with `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`.
- **`ngsw-config.json`:** asset groups for the app shell and icons. No `dataGroups`, so API data is never cached. `navigationUrls` excludes `/api/**`, a CRM gotcha.
- **Manifest and icons:** `public/manifest.webmanifest`, plus `public/icons/` with a neutral placeholder mark at 32, 48, 192, 512 and the 192/512 maskable sizes. `index.html` links the manifest, `theme-color` and the favicon from `icons/`.
- **Updates:** the default `ngsw` update check runs on navigation. No custom "new version" prompt (YAGNI).
- **Hosting:** check that nginx serves `ngsw-worker.js` and `ngsw.json` with `Cache-Control: no-cache`.

### D9. Full-screen dialogs on mobile (apps/web)
- Use one global `MAT_DIALOG_DEFAULT_OPTIONS` plus a CSS rule. Below the existing mobile breakpoint, a global stylesheet rule on `.cdk-overlay-pane.mat-mdc-dialog-panel` sets width and height to `100vw`/`100dvh`, `max-width: none` and border-radius 0.
- This puts no breakpoint logic in components and covers every dialog, current and future.
- **Alternative rejected:** a `BreakpointObserver` wrapper service around `MatDialog.open`. More code, and every caller would have to change.

### D10. Tooling (.claude)
- Split `CORNER_CASES.md` into an index that links to `.claude/corner-cases/<area>.md`. The areas are the CRM's: angular, auth, database, deploy-build, nestjs, queues, testing, zod.
- Import the CRM's generic entries that the template does not already have. Leave out anything tied to the CRM's domain (RH, time tracking, MCP, TargX).
- **`crud-module` skill:** port it to `.claude/skills/crud-module/SKILL.md` with `customers` as the worked example, `String` cuid ids and the template's paths.
- Update the CLAUDE.md "Corner Cases Memory" section to point at the new layout.

## Risks / Trade-offs

- **[Back-relation in `auth.prisma`]** → Keep it to a single relation field. A later better-auth schema regeneration must keep it; record this as a database corner case.
- **[better-auth internals: credential lookup, hook order]** → Cover with an e2e test in `apps/auth`, as in the CRM's `account-emails.e2e-spec.ts`. better-auth stays pinned to the version already in use.
- **[Auth e2e suites wiping each other's data when run in parallel]** → Run `apps/auth` `test:e2e` with `--runInBand`, if it is not already.
- **[Service worker caching a broken deploy]** → `ngsw` validates its manifest hashes. Rollback is to redeploy the previous build; `ngsw` picks it up on the next navigation.
- **[Substring redaction hiding useful log fields]** → Accepted. Logs prefer losing data to leaking it.
- **[Rate limiter needs a second Redis connection in auth]** → It is only one connection per worker. Fine.

## Migration Plan

1. Apply the Prisma migration for `push_subscription`. It is additive.
2. Set the new environment variables. `MAIL_PROVIDER` can be left unset (Brevo); for push, generate VAPID keys.
3. Deploy the backend and then the web. Rollback: the web change is independent, and on the backend the only migration adds a new table.

## Open Questions

None. The defaults decided here are: Brevo as the default provider, the test push on the account page, HTML for the new emails only, and no update prompt.
