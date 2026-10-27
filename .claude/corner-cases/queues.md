# Corner cases — Queues (BullMQ)

## Every app using `Transport.REDIS` must declare `ioredis` itself

`@nestjs/microservices` never imports `ioredis` statically — it resolves the driver lazily at
runtime (`client/client-redis.js`: `loadPackage('ioredis', ClientRedis.name, () => require('ioredis'))`),
and lists it as a wildcard peer. So a missing `ioredis` passes `pnpm build`, `check-types`, lint and
the whole test suite, then fails at boot with `Cannot find module 'ioredis'`.

`apps/worker` and `apps/notifications` ran for a long time without declaring it: `worker` inherited it
from `bullmq@5`, which pinned `ioredis: 5.10.1` as a hard dependency, and `notifications` got it purely
from pnpm hoisting. **`bullmq@6` moves `ioredis` to a peer dependency** (alongside `redis`, `pg` and
`bullmq-otel`, since v6 supports several Redis drivers), so that transitive copy disappears on upgrade.

Rule: if an app calls `app.connectMicroservice({ transport: Transport.REDIS })`, it declares `ioredis`
in its own `dependencies` — same range across all apps so pnpm resolves a single copy. Verify with
`node -e "require.resolve('ioredis')"` run **from the app's own directory**, not from the repo root;
hoisting at the root hides exactly the failure a pruned deploy reproduces.

## Bumping `bullmq`'s patch version in `apps/worker` alone can split the resolved version in two, breaking the build with a structural-typing error

**Symptom:** after bumping only `apps/worker/package.json`'s `bullmq` (e.g. `^6.3.1 → ^6.3.4`) and running a plain `pnpm install`, `pnpm build` fails in `apps/worker` with a TS2345 error whose message is a wall of near-identical `Queue<...>` generic types, bottoming out in `Property 'libName' is protected but type '...' is not a class derived from '...'`. The two types look identical but come from two different install paths in `node_modules/.pnpm/` — one `bullmq@6.3.4`, one `bullmq@6.3.1`.

**Cause:** `@nestjs/bullmq`'s peer range for `bullmq` (`^3 || ^4 || ^5 || ^6`) and `packages/shared`'s peer range (`^5.66.5 || ^6.0.0`) are both wide enough to admit the new version, but a plain `pnpm install` after editing only one `package.json` does not always force pnpm to re-resolve every peer-dependency combination against the new version — it can leave a stale `bullmq@6.3.1` resolution wired into `@nestjs/bullmq`'s peer context alongside the freshly-bumped `bullmq@6.3.4` used directly by `apps/worker`. TypeScript then sees two structurally-similar-but-distinct `Queue` classes and refuses the assignment.

**Fix:** run `pnpm dedupe` after bumping a package that multiple workspaces depend on (directly or via a peer range) — it collapses the two resolutions back to one (`grep -n "^  bullmq@" pnpm-lock.yaml` should show exactly one entry). A plain `pnpm install` is not guaranteed to do this on its own. If a build error names a "duplicate" class assignable to its own definition, suspect two resolved copies of the same package before suspecting an actual breaking API change.

## Bull Board can't replay a DLQ job: DLQ jobs sit in `waiting` in a queue nobody consumes

**Symptom:** the dashboard shows `email-queue-dlq` jobs but offers no retry for them; and a retry on the failed original in `email-queue` sends the email a second time.

**Cause:** `EmailConsumer` copies a permanently failed job into `email-queue-dlq` with `dlqQueue.add(job.name, job.data)`, so it is a fresh `waiting` job in a queue with no `@Processor`, while the failed original also stays in `email-queue` (`removeOnFail: 500`). Bull Board's retry only re-runs a `failed` job inside its own queue.

**Fix:** replay is `BaseDlqService.replay()` (`DLQ_REPLAY` message pattern), which re-adds the job to the original queue and removes it from the DLQ. The dashboard is therefore mounted with `readOnlyMode: true` on both queues (`apps/worker/src/bull-board/`).

## Bull Board is a mounted Express app: under the global prefix by default, outside guards, interceptors and CLS

**Symptom:** with `globalPrefix: 'api'` the dashboard answers at `/api/admin/queues`, not `/admin/queues`; `@UseGuards`/`@Audit` have no effect on it; and the 401/403/503 bodies it returns have no `correlationId` and a `path` like `/api/queues` instead of the full URL.

**Cause:** `@bull-board/nestjs` mounts the board's router through `MiddlewareConsumer.forRoutes(route)`, which Nest prefixes like any route. It is not a controller, so guards and interceptors never run. `ClsModule`'s middleware is mounted on `'*'` _under_ the prefix, so a route excluded from the prefix gets no CLS store; and Express strips the mount point from `request.url`, which is what `AllExceptionFilter` reports as `path`.

**Fix:** serve it at `/admin/queues` with `globalPrefixExclude: ['admin/queues']` (`workerBootstrapConfig`), and gate it with Bull Board's own `middleware` option: Nest runs it through its exception filters, so it can simply `throw` `UnauthorizedException` / `ForbiddenException` / `ServiceUnavailableException`. Pass a function, not a class: a class is resolved in `BullBoardRootModule`'s scope, which cannot see `SERVICES.AUTH`; build it in `forRootAsync`'s `useFactory`.

## Bull Board's `forFeature` instantiates the adapter class itself — formatters need a subclass, and `readOnlyMode` answers 405

**Symptom:** `adapter.setFormatter('data', …)` has nowhere to be called, because `forFeature({ name, adapter, options })` takes the adapter _class_ and `options` has no formatter slot.

**Fix:** a `BullMQAdapter` subclass that calls `this.setFormatter(...)` in its constructor (`RedactingBullMQAdapter`). Note `readOnlyMode` is enforced server-side — every queue-scoped write route returns **405** (`ERRORS.QUEUE_READ_ONLY`) through `queueProvider`; the global pause-all/resume-all answer 200 but skip read-only queues. `apps/worker/test/bull-board.integration.ts` lists every write route of the installed version and fails if an upgrade adds one that isn't covered.

## `EmailConsumer` drops a job name it does not know — and the job still counts as completed

Symptom: a new email never arrives, the queue is empty and no job failed (nothing in the DLQ either); the only trace is a `No handler for job <id> with name <name>` warning in the worker log. Cause: `process()` ends in a `default:` that only logs, so BullMQ marks the job done. It happens when `apps/notifications` enqueues a new `JOB_PATTERNS.SEND_*` while `apps/worker` is still an older build. Fix: deploy `apps/worker` before (or with) `apps/notifications` whenever a change adds a job; rolling back the worker alone loses jobs the same way. `PushConsumer` behaves the same for any name other than `SEND_PUSH_NOTIFICATION`. Pinned by `email.consumer.spec.ts` ("should log a warning for unknown job names").
