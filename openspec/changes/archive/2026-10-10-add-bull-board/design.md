# Design

## Context

- `apps/worker` owns `email-queue` and `email-queue-dlq` (`QueueModule.registerQueues([QUEUES.EMAIL])`). It serves HTTP on 3300 with global prefix `api`, default `helmet()`, no `trustProxy`, and has **no** `SERVICES.AUTH` client.
- Jobs reach the DLQ as **waiting** jobs in a queue with no `@Processor`; the failed original also stays in `email-queue` (`removeOnFail: 500`). Replay is `BaseDlqService.replay()`, exposed only as `DLQ_REPLAY`. This is why the dashboard is read-only (proposal → Why).
- Job inputs `send-password-reset-email.input.ts` (`resetLink`) and `send-email-verification-email.input.ts` (`verificationLink`) carry live account links.
- Bull Board is a mounted Express app: Nest guards, interceptors and filters do not run on its routes. The previous integration (`2c87e01^`) used an auth middleware that answered 401 even when auth was down.

## Goals / Non-Goals

**Goals:** admin-only read-only dashboard with the 401/403/503 contract; no account link ever rendered; one shared implementation of auth-service token validation.

**Non-Goals:** writes, audit events, replay UI, queue/job option changes.

## Decisions

1. **`apps/worker`: `@bull-board/nestjs`** (installed `9.10.4`, with `bullmq@6.3.10`) — `BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter, middleware })`, and `forFeature({ name, adapter, options: { readOnlyMode: true } })` for `QUEUES.EMAIL` and `QUEUES.EMAIL_DLQ`. Queue names only from `QUEUES`. The board is mounted under the global prefix by default (`/api/admin/queues` with the worker's `globalPrefix: 'api'`), so `workerBootstrapConfig` excludes it with `globalPrefixExclude: ['admin/queues']` to serve it at `/admin/queues`, the path the existing spec (and the docs) state. `main.ts` and the integration suite share that config (`src/bootstrap.config.ts`), so the test boots the real HTTP setup. *Verified (task 1.2):* `readOnlyMode` is enforced server-side, not just hidden in the UI — every queue-scoped write route goes through `queueProvider`, which answers **405 `ERRORS.QUEUE_READ_ONLY`**; pause-all/resume-all skip read-only queues; `POST /api/metrics/history/purge` only exists when a metrics-history provider is configured, which we do not. `readOnlyMode` also forces `allowRetries=false`, so the UI hides retry.

2. **`packages/shared`: extract `authenticateToken(authClient, token, logger)`** (`guards/authenticate-token.ts`, exported from `@repo/shared`) from `MicroserviceAuthGuard`. It sends `AUTH_AUTHENTICATE` bounded by `AUTH_RPC_TIMEOUT_MS` and maps RPC status 401 → `UnauthorizedException`, anything else → `ServiceUnavailableException` (logged). Token extraction and the "no token → 401" check stay with the caller. It is a plain function, not an injectable service: the guard's existing spec constructs `new MicroserviceAuthGuard(authClient, reflector)` and mocks `'../utils'`, so a new constructor dependency or a helper under `utils/` would have broken it. The guard delegates to it and its spec is unchanged. *Alternative:* copy the old middleware — rejected, it duplicated the guard and lost the 503 case.

3. **`apps/worker`: dashboard auth as Bull Board's own `middleware`** (`bullBoardAuth(authClient)`, a function). It extracts the token, calls `authenticateToken`, requires `RoleEnum.ADMIN`, and **throws** `UnauthorizedException` / `ForbiddenException` / the validator's `ServiceUnavailableException`. *Verified:* `BullBoardModule` applies `options.middleware` through Nest's `MiddlewareConsumer` ahead of the board's router, so what the middleware throws goes through Nest's exception filters and the global `AllExceptionFilter` shapes the body (`{ statusCode, timestamp, path, message }`) — no hand-written responses. Two consequences, both pinned by the integration suite: `path` is Express's mount-relative `request.url` (`/api/queues`), and there is **no `correlationId`**, because the board sits outside the `api` global prefix that `ClsModule`'s middleware is mounted under. It is a function, not a class, because a class would be resolved in `BullBoardRootModule`'s scope, which cannot see `SERVICES.AUTH`; the client comes from `forRootAsync` (`imports: ClientsModule.registerAsync([MicroserviceUtil.registerAuthService()])`, `inject: [SERVICES.AUTH]`).

4. **Redaction via a `BullMQAdapter` subclass** — `forFeature` takes the adapter *class* and instantiates it, and formatters are not settable through `options`, so the worker defines `RedactingBullMQAdapter extends BullMQAdapter` whose constructor calls `this.setFormatter('data', redact)`. `redact` replaces the values of `resetLink` and `verificationLink` with `'[redacted]'` on a copy, so stored job data is untouched and `DLQ_REPLAY` keeps the real link. *Verified (task 1.2):* the board's `formatJob` is the single output path (queue listing and job detail) and applies the `data` formatter; DLQ jobs carry `job.data` unchanged under the same job name, so a top-level key list is sufficient; the only link fields in `packages/shared/src/queue/input` are those two. The key list lives next to the job inputs, and a test fails when an input schema has a `z.url()` field missing from it. *Not covered by the formatter:* `failedReason`, `stacktrace` and `opts` are output verbatim; the consumer logs nothing into `job.log`. If a mail-provider error ever echoes a link, `failedReason` would show it (see Risks). *Alternative:* hide all data — rejected (recipient/template needed for diagnosis).

5. **`apps/worker/src/main.ts`**: `trustProxy: true` (as `apps/api` / `apps/auth`), which the existing "Client identity is derived correctly behind the proxy" requirement demands of every service exposed through the proxy. Be precise about what it buys: Express `req.ip` (per-client throttling on the worker's own Nest routes) uses the forwarded header; the pino request log still prints the socket peer (`req.remoteAddress` in `pino.config.ts`), so logs show the proxy's address — a pre-existing property of every service, not changed here. **No CSP relaxation by default.** *Verified (task 1.2, static analysis of `@bull-board/ui@9.10.4`):* the page uses same-origin `<script defer src>` files, a `type="application/json"` config block (not executed), inline `<style>`/`style=""` and a Google Fonts stylesheet — all inside the default `helmet()` CSP (`script-src 'self'`, `style-src 'self' https: 'unsafe-inline'`, `font-src 'self' https: data:`). The earlier assumption that the default CSP blanks the UI is therefore not supported for this version. Task 3.1 proves it with a request-level test under the real helmet; a path-scoped relaxation is added **only if** that test shows a blocked resource. Note `upgrade-insecure-requests` in helmet's default CSP can break the UI over plain `http://` in local dev (same as the worker's Swagger); that is a dev-only concern, not a production one.

6. **No new constants or env**: the route is fixed (`BULL_BOARD_ROUTE`). **Proxy:** the dashboard is served at `/admin/queues/` on the frontend origin by the host-level `docs/deploy/nginx/frontend.conf`, as `location = /admin/queues` (301 to the slash form) plus `location ^~ /admin/queues/ { proxy_pass http://127.0.0.1:3300; … }` with no URI on `proxy_pass`. *Verified in an nginx container:* `^~` is required — as a plain prefix the config's static-asset regex outranks it and the board's `static/*.js` returns 404 from the SPA root — and the SPA's missing-asset 404 and history fallback are unchanged. The web container's `apps/web/nginx.conf.template` is left alone so `web` takes no dependency on the worker. *Alternative:* a sibling subdomain with its own `queues.conf` — better isolation, new DNS/certificate; chosen against for this template.

## Auth / authorization impact

`ADMIN` only. No new roles or guards in Nest's guard chain; one new Express middleware in the worker. `MicroserviceAuthGuard` behaviour is unchanged (refactor only). Read-only mode removes the CSRF exposure between sibling subdomains (`SameSite=Lax` does not cover them), because nothing on the dashboard changes state.

## Risks / Trade-offs

- [`readOnlyMode` or the formatter behave differently after a `@bull-board` upgrade] → verified for `9.10.4` in task 1.2; tests 3.2/3.4 pin the behaviour so an upgrade that changes it fails the build.
- [Default CSP turns out to block a dashboard resource at runtime] → task 3.1 loads the UI under the real helmet; relax only that path, only for the directive that failed.
- [`failedReason`/`stacktrace` can show a link echoed by a mail-provider error] → not redacted by the `data` formatter; accepted as a known gap for an admin-only page, revisit if the provider's errors are found to include request bodies.
- [Formatter covers display, not the JSON API] → the formatter is applied by the board's API responses (which the UI consumes); test 3.4 asserts the API JSON, not just the HTML.
- [`bullmq@6` peer drift] → `pnpm dedupe`, single `bullmq` lock entry (CORNER_CASES).

## Migration Plan

1. Dependencies + `authenticateToken` extraction (guard tests unchanged).
2. Dashboard + middleware in the worker; no data migration.
3. Add the `frontend.conf` location, reload nginx; verify `401` anonymous, `403` non-admin, `200` admin, `503` with auth stopped, and redaction end to end.
4. Rollback: remove the nginx location or revert the worker module; nothing persistent changes.

## Open Questions

Dashboard throttling (proposal, Open Question 2) — deferrable.
