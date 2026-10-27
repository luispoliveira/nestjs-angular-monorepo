# Tasks

## 1. Dependencies and verification of the dashboard API

- [x] 1.1 apps/worker: add `@bull-board/api`, `@bull-board/express`, `@bull-board/nestjs`; run `pnpm install && pnpm dedupe` and verify `grep -n "^  bullmq@" pnpm-lock.yaml` shows one entry and `pnpm build` passes
- [x] 1.2 apps/worker: confirm in the installed package that `BullMQAdapter` accepts `readOnlyMode` and `setFormatter('data', …)`, and note the UI's CSP needs; record the result in `design.md` Decisions 1, 4 and 5 (verify by citing the package's type definitions)

## 2. Shared auth validation

- [x] 2.1 packages/shared: write tests first, then extract `AuthTokenValidator` from `MicroserviceAuthGuard` (no token / RPC 401 → 401, timeout or other error → 503); verify the new spec and the unchanged `microservice-auth.guard.spec.ts` pass
- [x] 2.2 packages/shared/src/queue/input: export the list of redacted link keys (`resetLink`, `verificationLink`) and a test that fails when any input schema has a `z.url()` field not in the list; verify with `pnpm --filter @repo/shared test`

## 3. Dashboard in the worker

- [x] 3.1 apps/worker/src/main.ts: `trustProxy: true`; verify a request-level test loads the dashboard HTML and its static assets under the real `helmet()` with no CSP violation (relax the header for `/admin/queues` only if this test shows a blocked resource) and that the worker trusts exactly `TRUSTED_PROXY_HOPS` proxy hop
- [x] 3.2 apps/worker: tests first, then `BullBoardModule` at `/admin/queues` with `QUEUES.EMAIL` and `QUEUES.EMAIL_DLQ` in `readOnlyMode`; verify an admin sees both queues and a write request (retry/remove/clean/pause) leaves the job and queue unchanged
- [x] 3.3 apps/worker: tests first, then the dashboard auth middleware (register `SERVICES.AUTH`); verify one test each for 401 (no token, rejected token), 403 (non-admin), 503 (auth timeout), with the `AllExceptionFilter` response shape and no board content
- [x] 3.4 apps/worker: tests first, then the `data` formatter on both adapters; verify the board API JSON for a password-reset job shows `[redacted]` and the recipient, and that the job stored in Redis keeps the real link

## 4. Deployment and docs

- [x] 4.1 docs/deploy/nginx/frontend.conf + DEPLOY.md + DEPLOY-PM2.md: `location = /admin/queues` and `location ^~ /admin/queues/` proxying to the worker, forwarding client IP headers; verify in an nginx container that the board's static assets reach the upstream (and 404 without `^~`), that `/missing.js` still 404s and a client route still falls back to `index.html`
- [x] 4.2 apps/worker/README.md: restore the dashboard section (read-only, admin-only, replay via `DLQ_REPLAY`) and the DLQ alert pointer; verify the URL matches the route
- [x] 4.3 .claude/CORNER_CASES.md: add the non-obvious findings (DLQ jobs are `waiting`, so the dashboard cannot replay them; helmet CSP blanks the UI; anything from 1.2); verify each entry names symptom and fix

## 5. Integration

- [x] 5.1 Run `/verify`: admin 200, non-admin 403, anonymous 401, auth stopped 503, a password-reset job in the DLQ shows `[redacted]`, and `DLQ_REPLAY` of it still sends the real link; verify `pnpm build`, `pnpm lint`, `pnpm check-types` and tests pass
