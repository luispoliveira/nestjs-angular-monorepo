## 1. chore: declare the ioredis runtime peer (prerequisite)

Must land before section 3 — `bullmq@6` stops installing `ioredis`, and these two apps currently rely on that transitive copy. See design.md — D1, D2.

- [x] 1.1 apps/worker: add `"ioredis": "^5.11.1"` to `dependencies`, matching the range already in `apps/auth/package.json`; verify `pnpm install` succeeds and `node -e "require.resolve('ioredis')"` run from `apps/worker` resolves
- [x] 1.2 apps/notifications: add `"ioredis": "^5.11.1"` to `dependencies`; verify `node -e "require.resolve('ioredis')"` run from `apps/notifications` resolves
- [x] 1.3 Verify pnpm resolves a single ioredis version for all three apps — `pnpm why ioredis` lists one 5.x entry, not two

## 2. chore: bump all patch and minor dependencies

32 packages, no major boundaries crossed. Largest diff, lowest risk — lands before the majors so a regression here is not misattributed to one of them. See design.md — D3.

- [x] 2.1 Bump the 16 minor-level dependencies across all workspaces (`@prisma/client` + `@prisma/adapter-pg` 7.10, `better-auth` + `@better-auth/prisma-adapter` 1.7.2, `@sentry/nestjs` 10.71.0, `eslint` 10.9.1, `jest` 30.5.0, `nestjs-zod` 5.5.0, `pg` 8.23.0, `helmet` 8.3.0, `typescript-eslint` 8.68.0, `globals` 17.11.0, `@types/node` 26.4.0, `@faker-js/faker` 10.6.0, `testcontainers` + `@testcontainers/postgresql` 12.1.0); verify `pnpm install` resolves with no peer warnings
- [x] 2.2 Bump the 16 patch-level dependencies (`@angular/*` 22.1.x, `@tanstack/angular-query-experimental`, `@eslint/eslintrc`, `eslint-plugin-turbo`, `nestjs-cls`, `prettier`, `prom-client`, `ts-jest`, `turbo`, `@types/supertest`); verify `pnpm install` succeeds
- [x] 2.3 Confirm `pnpm-workspace.yaml`'s `zod: ~4.4.3` override is untouched and still enforced — `pnpm verify:zod-version` passes
- [x] 2.4 Verify the sweep: `pnpm build && pnpm lint && pnpm check-types && pnpm test` all pass

## 3. chore: bump bullmq to 6 and @nestjs/bullmq to 11.0.5

Depends on section 1. `@nestjs/bullmq@11.0.5` accepts `bullmq ^3||^4||^5||^6` and stays CommonJS; v12 is a pure-ESM republish and is deferred. See design.md — D4 (revised), D4b.

- [x] 3.1 Read the BullMQ v6 migration notes and confirm the API surface this repo uses is unchanged: `Queue.add / getJob / getJobs / getJobCounts`, `Job.name / data / remove`, `@Processor` + `WorkerHost.process`, `@OnWorkerEvent('failed')`; verify by listing any breaking change that touches those symbols — if `QueueModule.registerQueues` or the processor connection config changed, stop and report rather than adapting silently (design.md — Risks) — **done, and it did surface a deviation**: v12 is ESM-only, D4 revised to 11.0.5
- [x] 3.2 packages/shared: widen the **peerDependencies** ranges to `"bullmq": "^5.66.5 || ^6.0.0"` and `"@nestjs/bullmq": "^11.0.5"` — bullmq is a peer here, not a dependency, so no `ioredis` declaration belongs in this package (D4b); verify the manifest still has no `bullmq` entry under `dependencies` or `devDependencies`
- [x] 3.3 packages/shared: verify `pnpm --filter @repo/shared test` passes against the widened range, covering `base.producer.spec.ts` and `base.dlq.service.spec.ts`
- [x] 3.4 apps/worker: bump `bullmq` to ^6.3.1 and `@nestjs/bullmq` to ^11.0.5; verify `pnpm --filter worker test` passes, covering `email.consumer.spec.ts`, `email.dlq.service.spec.ts`, `base.dlq.service.spec.ts` and `queue-metrics.service.spec.ts`
- [x] 3.5 Verify no code reads a `paused` job state — v6 removed `'paused'` from the `JobType` union and from the default `getJobCounts()` key set, so `getJobs(['paused'])` is now a type error and `counts.paused` is `undefined`; grep `apps/worker` and `packages/shared` for `paused` and confirm zero hits
- [x] 3.6 Verify `ioredis` still resolves from `apps/worker`, `apps/notifications` and `packages/shared` now that bullmq no longer provides it transitively — this is the failure section 1 exists to prevent

## 4. chore: bump jsdom to 30 in apps/web

Contained to the vitest DOM environment. See design.md — D3.

- [x] 4.1 apps/web: bump `jsdom` to ^30.0.1; verify `pnpm --filter web test` passes under the Angular/vitest runner

## 5. chore: bump @getbrevo/brevo to 6 in packages/mail

Two source files. v6 keeps v5's `exports` shape (`.` and `./transactionalEmails`). See design.md — Risks.

- [x] 5.1 packages/mail: bump `@getbrevo/brevo` to ^6.0.3 and confirm `BrevoClient` (from `@getbrevo/brevo`) and `SendTransacEmailRequest` (from `@getbrevo/brevo/transactionalEmails`) still exist under those names; verify `pnpm --filter @repo/mail test` passes, covering `brevo.provider.spec.ts`
- [x] 5.2 packages/mail: if v6 renamed either symbol, update `brevo.provider.ts` and `brevo.provider.spec.ts` to the new names with no change to `MailProvider`'s interface; verify the spec passes and `packages/mail/src/mail.module.ts` needs no edit — **condition did not apply**: v6 kept both symbols, no source edit was needed

## 6. Verification and record

- [x] 6.1 Run the full gate from a clean install — `rm -rf node_modules && pnpm install && pnpm build && pnpm lint && pnpm check-types && pnpm test`; verify all pass and the lockfile has no uncommitted drift afterwards
- [x] 6.2 Boot-check the two apps whose dependency graph changed: start `apps/worker` and `apps/notifications` against local infra (`pnpm docker:up`) and verify each reaches its Redis transport without a `Cannot find module 'ioredis'` — the failure mode no test in the repo catches
- [x] 6.3 .claude/CORNER_CASES.md: append an entry under "Queues (BullMQ)" recording that `bullmq@6` demotes `ioredis` to a peer and that every app using `Transport.REDIS` must declare it, since `@nestjs/microservices` resolves it via a lazy `require`; verify the entry is present under the right heading
- [x] 6.4 openspec/changes/update-packages/design.md: record the blocked majors and their unblock conditions (NestJS 12 ← `@thallesp/nestjs-better-auth` opening its peer range; TypeScript 7 ← Angular 23 + a ts-jest major; Prisma 8 ← a stable release; ioredis 6 ← rides with NestJS 12) so the audit is not repeated; verify against the Non-goals list in proposal.md
