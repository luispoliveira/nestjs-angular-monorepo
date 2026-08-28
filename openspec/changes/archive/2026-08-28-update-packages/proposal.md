## Why

48 dependencies across the monorepo are behind their latest published versions, and the gap keeps widening while the majors that matter stay unreachable. A dependency audit showed that the four largest upgrades (NestJS 12, TypeScript 7, Prisma 8, ioredis 6) are hard-blocked by peer ranges we do not control, so "update everything" is not a decision we get to make — but the 32 patch/minor bumps and four isolated majors that *are* reachable have no reason to wait behind them.

The audit also surfaced a latent packaging bug: `apps/worker` and `apps/notifications` both call `app.connectMicroservice({ transport: Transport.REDIS })`, and `@nestjs/microservices` resolves its Redis driver through a lazy `require('ioredis')` at runtime (`client-redis.js`), yet neither app declares `ioredis` as a dependency. They work today only because pnpm's hoisting happens to expose the copy installed for `apps/auth` and `bullmq`. A `pnpm dedupe`, a `nodeLinker` change, or a deploy that prunes per-app `node_modules` breaks both services at boot.

## What Changes

- Bump all 16 patch-level and 16 minor-level dependencies to latest across every workspace (Angular 22.1.x, Prisma 7.10, better-auth 1.7.2, eslint 10.9.1, jest 30.5.0, `@types/node` 26.4.0, and others).
- Bump four majors whose blast radius is contained to a single package:
  - `bullmq` 5 → 6 and `@nestjs/bullmq` 11 → 12 (`apps/worker`, `packages/shared`). `@nestjs/bullmq@12` declares `@nestjs/core: ^10||^11||^12`, so it moves without dragging NestJS core with it.
  - `jsdom` 28 → 30 (`apps/web`, vitest DOM environment only).
  - `@getbrevo/brevo` 5 → 6 (`packages/mail`, two source files).
- Declare `ioredis` explicitly in `apps/worker` and `apps/notifications`, matching the version already declared in `apps/auth`. **This is a bug fix, not an upgrade** — it makes an existing implicit runtime requirement explicit.
- Record the blocked majors and the upstream condition that unblocks each, so the next person does not repeat the audit.

No breaking changes. No application behavior changes.

## Capabilities

### New Capabilities

None. This change introduces no new behavior.

### Modified Capabilities

None. This is a dependency and packaging change: no requirement in `openspec/specs/` changes its observable behavior. `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- **NestJS 11 → 12.** Blocked by `@thallesp/nestjs-better-auth@2.7.0`, whose peer range is a closed `@nestjs/common: ^11.1.6` / `@nestjs/core: ^11.1.6`, and by `nestjs-zod@5.5.0` (`@nestjs/common: ^10.0.0||^11.0.0`). Both sit on the critical path — auth and global validation — and the project forbids replacing better-auth with Passport/JWT, so there is no route around them.
- **TypeScript 6 → 7.** Blocked twice: `@angular/compiler-cli@22` pins `typescript: >=6.0 <6.1`, and `ts-jest` (latest 29.4.12) pins `typescript: >=4.3 <7`. Needs Angular 23 and a ts-jest major.
- **Prisma 7 → 8.** Latest published is `8.0.0-rc.12`. Release candidates do not go into this repo.
- **ioredis 5 → 6.** Deferred rather than blocked: `bullmq@6` (`>=5.0.0`) and `@nestjs/microservices` (`*`) both accept it, but NestJS 11 predates ioredis 6 and its Redis transport is not verified against it. The declaration fix below is the value here; the version bump is not, and it can ride along with the NestJS 12 upgrade once that unblocks.
- `@nestjs/cli` and `@nestjs/schematics` 11 → 12. Build-time devDependencies whose majors track the NestJS core release we are not taking.
- Any refactor, feature work, or code change beyond what a dependency bump mechanically requires.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `bullmq` 6 changes `Queue`/`Job`/`WorkerHost` surface used by `EmailConsumer`, `EmailProducer`, `BaseProducer`, and the DLQ services | Confine to one step; `apps/worker` and `packages/shared` both have unit tests over these paths. Verify against the v6 migration notes before editing, and run `pnpm test` for both workspaces. |
| `@getbrevo/brevo` 6 renames the client or its subpath exports | v6 keeps the same `exports` shape as v5 (`.`, `./transactionalEmails`), and usage is limited to `BrevoClient` + `SendTransacEmailRequest` in `brevo.provider.ts`, covered by `brevo.provider.spec.ts`. |
| `jsdom` 30 breaks the Angular/vitest DOM environment | Contained to `apps/web` test runs; `pnpm test` in that workspace is the check. |
| A minor bump regresses silently | CI (`.github/workflows/ci.yml`) plus `pnpm build`, `pnpm lint`, `pnpm check-types`, `pnpm test` run as an explicit verification step. |
| Declaring `ioredis` in two more apps pulls a second copy into the store | Pin the same range already used by `apps/auth` (`^5.11.1`) so pnpm resolves one version. |

## Alternatives considered

- **Run `npx npm-check-updates -u` (the existing `update-packages` script) and take everything.** Rejected: it would move TypeScript to 7 and NestJS to 12, both of which fail peer resolution, and would pull Prisma to a release candidate.
- **Patches and minors only, no majors.** Safer, but leaves four contained majors to age for no gain; each is isolated to one package with test coverage.
- **Fix the `ioredis` declarations in a separate change.** Rejected: the audit that found it is this one, and the fix is two lines. Splitting it risks it being forgotten, which is how it got here.

## Impact

- **Affected workspaces**: all of `apps/*` and `packages/*` for the patch/minor sweep; `apps/worker` and `packages/shared` for BullMQ; `apps/web` for jsdom; `packages/mail` for Brevo; `apps/worker` and `apps/notifications` for the `ioredis` declaration.
- **Affected files**: `package.json` in each workspace, `pnpm-lock.yaml`, and — only if BullMQ 6 or Brevo 6 require it — `apps/worker/src/**`, `packages/shared/src/queue/**`, `packages/shared/src/abstracts/**`, `packages/mail/src/providers/brevo.provider.ts`.
- **Not affected**: `pnpm-workspace.yaml`'s `zod: ~4.4.3` override, the Prisma schema and migrations, and every runtime code path outside the dependency edits above.
- **Deployment**: none beyond a normal rebuild. The `ioredis` declarations make an existing runtime requirement explicit and remove a hoisting dependency from the `worker` and `notifications` deploys.
