## Context

See [proposal.md](proposal.md) — Why. Two facts from the audit shape the whole approach:

**1. `bullmq@6` demotes `ioredis` from dependency to peer.**

```
bullmq@5.79.3  dependencies: { tslib, semver, ioredis: "5.10.1", msgpackr, cron-parser: "4.9.0", ... }
bullmq@6.3.1   dependencies: { tslib, semver,                    msgpackr, cron-parser: "5.6.1", ... }
               peerDependencies: { ioredis: ">=5.0.0", redis: ">=5.0.0", pg: ">=8.0.0", bullmq-otel: ">=2.0.0" }
```

v6 supports multiple Redis drivers, so it no longer installs one for you.

**2. Two apps rely on that transitive copy without declaring it.**

`@nestjs/microservices` resolves its Redis driver lazily at runtime:

```js
// @nestjs/microservices/client/client-redis.js:21
redisPackage = loadPackage('ioredis', ClientRedis.name, () => require('ioredis'));
```

Every app calling `connectMicroservice({ transport: Transport.REDIS })` therefore needs `ioredis` resolvable from its own `node_modules`:

```
apps/auth           Transport.REDIS   declares ioredis ^5.11.1   ✓ correct
apps/worker         Transport.REDIS   NOT declared              ← via bullmq@5's hard dep
apps/notifications  Transport.REDIS   NOT declared              ← via pnpm hoisting only
```

Combining the two: upgrading `bullmq` to 6 removes the copy `apps/worker` is currently living on. The declaration fix is not adjacent cleanup — it is a **hard prerequisite**, and skipping it turns a green build into a boot-time `Cannot find module 'ioredis'` in production.

The BullMQ API surface actually used is narrow and unchanged across the major: `Queue.add / getJob / getJobs / getJobCounts`, `Job.name / data / remove`, `@Processor` + `WorkerHost.process`, `@OnWorkerEvent('failed')`. No repeatable or cron-scheduled jobs exist, so `cron-parser` 4 → 5 inside BullMQ is not reachable from this codebase.

## Goals / Non-Goals

**Goals:**

- Sequence the work so no intermediate commit leaves a service unable to boot.
- Keep each major upgrade isolated enough that a CI failure names its own cause.
- Leave the blocked majors recorded with their unblock condition, so the audit is not repeated.

**Non-Goals:**

- See [proposal.md](proposal.md) — Non-goals for the excluded upgrades. Nothing is added here.
- Restructuring how Redis connections are configured. `MicroserviceUtil.getRedisOptions()` and `QueueModule` keep their current shape; only the declaration of the driver package changes.

## Decisions

### D1. Fix the `ioredis` declarations *before* touching BullMQ

Ordering, not preference. Between the two steps `apps/worker` has no resolvable `ioredis`, so the fix must land first. Doing it first also means the BullMQ step's diff contains only BullMQ, which is what makes a bisect useful.

*Alternative considered:* one combined commit. Rejected — it merges a bug fix with an upgrade, and a boot failure would not distinguish "bullmq 6 broke us" from "we forgot the peer".

### D2. Declare `ioredis: ^5.11.1`, matching `apps/auth` — do not bump to 6

The range already proven in this repo, and identical across all three apps so pnpm resolves a single copy in the store. ioredis 6 is a separate decision: NestJS 11's Redis transport predates it and is unverified against it, and taking it here would mean debugging a driver major and a queue major in the same change.

*Alternative considered:* declaring `ioredis: ^6.0.0` while we are editing these files anyway. Rejected — `bullmq@6`'s peer (`>=5.0.0`) permits it, but permission is not verification, and the transport failure mode is at boot, not at build.

### D3. Order the majors by blast radius, each verified before the next

```
step 1  ioredis declarations   apps/worker, apps/notifications   ← prerequisite
step 2  patches + minors (32)  all workspaces                    ← largest diff, lowest risk
step 3  bullmq 6 + @nestjs/bullmq 12   apps/worker, packages/shared
step 4  jsdom 30               apps/web
step 5  brevo 6                packages/mail
```

Steps 3–5 touch disjoint workspaces and could run in any order; they are sequenced so that a `pnpm test` failure after each one has exactly one candidate cause. Step 2 sits early because a broken minor is cheaper to find before three majors are layered on top of it.

*Alternative considered:* all majors in one step after the minors. Rejected for the same bisect reason as D1.

### D4. `@nestjs/bullmq` goes to **11.0.5**, not 12 — revised

*Original decision: take `@nestjs/bullmq@12`, justified by its peer range `@nestjs/core: ^10||^11||^12`. That range is genuine, but the reasoning missed what the major actually contains.*

`@nestjs/bullmq@12.0.0` declares `"type": "module"` — it is a pure-ESM republish, and that packaging change is its only functional content. Meanwhile `@nestjs/bullmq@11.0.5` already declares `bullmq: ^3||^4||^5||^6` and stays CommonJS. Both facts verified against the registry:

```
@nestjs/bullmq@11.0.5   (no "type" field → CJS)   peer bullmq: ^3||^4||^5||^6
@nestjs/bullmq@12.0.0   "type": "module"          peer bullmq: ^3||^4||^5||^6
```

So 11.0.5 spans both sides of step 3 on its own. It also carries the one compatibility shim v6 requires — `getConnectionStatus()` routing `connection?.status` through `getBackend().client.status`.

Taking 12 would buy nothing functional while adding real exposure: deep imports into `@nestjs/bullmq/dist/*` stop resolving, and CJS apps reach it only through Node's `require(esm)`. This repo would probably survive both — it is already on `moduleResolution: nodenext` and runs Node 24 — but "probably survives, gains nothing" is not a trade worth making inside a dependency sweep.

*Alternative considered:* take 12 anyway to avoid a second upgrade later. Rejected — the ESM migration is its own change with its own verification, and bundling it here would mean a queue major and a packaging major failing indistinguishably.

`@nestjs/bullmq@12` moves to the deferred table below.

### D4b. `packages/shared` widens its peer range — it does not declare `ioredis`

An earlier draft of this decision said `packages/shared` needed `ioredis` declared too, reasoning that it depends on `bullmq`. Checking the manifest showed otherwise:

```json
"peerDependencies": { "@nestjs/bullmq": "^11.0.4", "bullmq": "^5.66.5" }
"dependencies":     { }   // no bullmq
"devDependencies":  { }   // no bullmq either
```

`bullmq` is a **peer** of `packages/shared`, not a dependency — the package never installs it, so it never needs to satisfy bullmq's own peers. The consuming app does, and `apps/worker` was already covered in section 1. Adding `ioredis` here would declare a dependency the package does not have.

What it does need is a peer range that admits the major its only consumer is moving to. Widen rather than replace — the API `base.producer.ts` and `base.dlq.service.ts` use is identical on both majors, so the package genuinely supports either:

```json
"@nestjs/bullmq": "^11.0.5", "bullmq": "^5.66.5 || ^6.0.0"
```

### D5. Verify with the existing gates; add nothing

`pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test` plus CI (`.github/workflows/ci.yml`) already cover this. `packages/mail` and `apps/worker` have unit tests over exactly the code the majors touch (`brevo.provider.spec.ts`, `email.consumer.spec.ts`, `base.dlq.service.spec.ts`, `base.producer.spec.ts`). Writing new tests for a dependency bump would test the dependency, not this repo.

The one check that no existing gate performs is the `ioredis` resolution fix — the tests mock the transport, so a missing driver passes CI and fails at boot. Step 1 is therefore verified by resolving the module from each app's own directory rather than by a test run.

## Risks / Trade-offs

- **A green CI does not prove the `ioredis` fix worked** → verify by resolving `ioredis` from `apps/worker` and `apps/notifications` directly after install, not by test results.
- **pnpm hoisting can mask a still-missing peer on this machine** → resolve from each app's own directory, which is the condition a pruned deploy reproduces.
- **`bullmq@6` may change queue connection options accepted by `QueueModule`** → the used API surface is enumerated in Context and is narrow; if `QueueModule.registerQueues` or the `@Processor` connection config does change, that is a design deviation and stops for review rather than being absorbed.
- **`@getbrevo/brevo@6` may rename the client despite a stable `exports` map** → contained to `brevo.provider.ts` with a spec that mocks `BrevoClient`; a rename fails the spec immediately.
- **Splitting into five verified steps costs more wall-clock than one `pnpm up`** → accepted deliberately; the failure it prevents is a production boot failure in two services.

## Deferred majors and their unblock conditions

Recorded so the audit behind [proposal.md](proposal.md) — Non-goals is not repeated. Each row is checkable with a single `npm view` against the named package.

| Upgrade | Blocked by | Unblocks when | Check |
|---|---|---|---|
| NestJS 11 → 12 (`@nestjs/common`, `core`, `microservices`, `platform-express`, `testing`, `config`, `schedule`, `cli`, `schematics`) | `@thallesp/nestjs-better-auth@2.7.0` peers on a closed `@nestjs/common: ^11.1.6` / `@nestjs/core: ^11.1.6`; `nestjs-zod@5.5.0` peers on `@nestjs/common: ^10.0.0\|\|^11.0.0` | **Both** open their peer range to `^12`. `@nestjs/swagger` 12 already exists, so nestjs-zod is the nearer of the two. No workaround exists: replacing better-auth with Passport/JWT is forbidden by the project's conventions | `npm view @thallesp/nestjs-better-auth peerDependencies` <br> `npm view nestjs-zod peerDependencies` |
| TypeScript 6 → 7 | `@angular/compiler-cli@22` pins `typescript: >=6.0 <6.1`; `ts-jest` (latest 29.4.12) pins `typescript: >=4.3 <7` | Angular 23 ships with a TS 7 range **and** ts-jest publishes a major that lifts its `<7` ceiling. Both are required — Angular alone unblocks only `apps/web`, ts-jest alone only the NestJS apps | `npm view @angular/compiler-cli peerDependencies` <br> `npm view ts-jest peerDependencies` |
| Prisma 7 → 8 | Latest published is `8.0.0-rc.12` | A stable `8.x` is on the `latest` dist-tag | `npm view prisma dist-tags` |
| `@nestjs/bullmq` 11 → 12 | Not blocked — its peer range genuinely accepts NestJS 11. Deferred because v12 is a pure-ESM republish (`"type": "module"`) whose only content is the packaging change, while `11.0.5` already supports `bullmq ^6` | Take it as part of a deliberate ESM migration, not a dependency sweep. Deep imports into `@nestjs/bullmq/dist/*` stop resolving, and CJS entry goes through Node's `require(esm)` | `npm view @nestjs/bullmq@12 type` |
| ioredis 5 → 6 | Not blocked by any peer range — `bullmq@6` accepts `>=5.0.0` and `@nestjs/microservices` accepts `*`. Deferred because NestJS 11's Redis transport predates ioredis 6 and is unverified against it, and its failure mode is at boot, not at build | Ride it along with the NestJS 12 upgrade, where the transport is being revalidated anyway | — |

Re-run the full picture with `pnpm outdated -r`.

## Migration Plan

No data migration, no schema change, no deployment sequencing. Each step is `package.json` edits plus `pnpm install`, verified before the next begins.

Rollback is `git revert` of the offending step plus `pnpm install` — the lockfile is committed, so reverting restores the exact prior resolution. No step leaves persistent state behind: no migration is run, no queue payload format changes, and no Redis key layout is touched.

Step 1 is the exception worth noting on deploy: it changes what each app's `node_modules` must contain, so `apps/worker` and `apps/notifications` need a fresh install rather than a warm one.
