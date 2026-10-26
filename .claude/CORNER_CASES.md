# Corner Cases — Index

Non-obvious behaviours and gotchas already paid for once. **At the start of a task, read this index, then the area file(s) for what you are about to touch.**

Adding one: write the entry in its area file (`## <the gotcha, as a claim>` + symptom → cause → fix → where it is verified, a few lines), then add its title here under the same area. New area → new file + section here. Remove or update an entry the moment the code it describes changes.

## [Zod v4 / nestjs-zod / OpenAPI](corner-cases/zod.md)

- `.meta({ id })` does not name the OpenAPI component — the DTO class does
- Response DTOs built on a schema with `DateToISOString` need `createZodDto(schema, { codec: true })`
- Re-`.meta({ id })`ing an already-registered schema breaks it as a `@Query()` DTO — and the app won't boot
- `zodValidator()` reports a `z.union` failure once, at the union's path
- A `.refine()` predicate without `: boolean` narrows the output type
- `.pick()` and `.omit()` throw at runtime on an object schema carrying a `.refine()`
## [NestJS / SharedModule](corner-cases/nestjs.md)

- Sentry tracing silently records nothing unless Sentry initialises before every other import
- `AllExceptionFilter` nests a custom exception's payload under `.message`
- `apps/*` cannot import each other's `src/` — shared domain logic belongs in `packages/shared`
- Global guard registration order is execution order
- A literal route segment must be declared before a `:param` route that would capture it
- A file endpoint must not return an object, or `LoggingInterceptor` persists the file
- `ConfigModule.forRoot()` reads the environment when `AppModule` is imported — an integration suite cannot set an env var in `beforeAll`
- A file read at runtime must be listed in `nest-cli.json` `assets`, or it is missing from `dist`

## [Authentication (better-auth)](corner-cases/auth.md)

- `BETTER_AUTH_URL` drives the `Secure` cookie prefix, not the proxy headers
- better-auth 1.7.3 validates the Prisma schema at startup by default and rejects auth requests on any mismatch
- better-auth routes run outside Nest: no CLS, no interceptors, and an after hook that throws replaces the response
- `*` means opposite things to `enableCors` and to `trustedOrigins`
- `admin.createUser` sends no verification email — invitations go through `requestPasswordReset`
- `onPasswordReset` receives the user as loaded _before_ the reset
- `@AfterHook` handlers also run for refused requests
- `apps/auth` e2e suites must run in band
- The global throttler does not cover `/api/auth/*` — better-auth limits itself

## [Queues (BullMQ)](corner-cases/queues.md)

- Every app using `Transport.REDIS` must declare `ioredis` itself
- Bumping `bullmq`'s patch version in `apps/worker` alone can split the resolved version in two, breaking the build with a structural-typing error
- Bull Board can't replay a DLQ job: DLQ jobs sit in `waiting` in a queue nobody consumes
- Bull Board is a mounted Express app: under the global prefix by default, outside guards, interceptors and CLS
- Bull Board's `forFeature` instantiates the adapter class itself — formatters need a subclass, and `readOnlyMode` answers 405
- `EmailConsumer` drops a job name it does not know — and the job still counts as completed

## [Database (Prisma / PrismaPg)](corner-cases/database.md)

- Partial unique indexes must be declared in the schema (`partialIndexes` preview), never hand-written into a migration
- `pnpm db:generate` alone is not enough after editing `auth.prisma` — `packages/database` must also be rebuilt
- If a future schema correction must reach every template consumer, regenerate `init` — not a currently-applied exception
- The seeder can hit `ECONNREFUSED` on a cold boot, on a healthy Postgres
- `PushSubscription` adds a relation to better-auth's `User` model in `auth.prisma`
- `prisma migrate dev` cannot run non-interactively — diff the schema instead
- A real `P2002` under `PrismaPg` has no `meta.target`
- A raw-SQL `CHECK` constraint is invisible to Prisma — its only witness is a direct-insert test
- `pg_advisory_xact_lock` must be called through `$executeRaw`, not `$queryRaw`
- No `Promise.all` on a transaction's `tx`
- `pnpm db:seed` is a no-op — the seeder runs when an app that imports `DatabaseSeederModule` boots
- Use an enum value added by `ALTER TYPE ... ADD VALUE` only in a later migration
- Making a relation optional changes Prisma's expected FK action to `ON DELETE SET NULL`
- A `\s` inside a `$queryRaw` template literal reaches Postgres as `s`

## [Angular](corner-cases/angular.md)

- `ngsw-worker.js` only shows a push wrapped in `notification` — and opens its URL only through `data.onActionClick`
- `<mat-dialog-content class="flex …">` silently renders as `display: block`
- `apps/web` is zoneless — a plain-field mutation plus `detectChanges()` re-renders nothing
- Two `<ng-content>` in different `@if` branches: only the first ever receives the content
- `@if (expr; as alias)` is not narrowed enough to index a `Record`
- `model()` already declares `xChange` — an explicit `output` of the same name is NG1054
- `viewChild` with an explicit generic _and_ a `read` option does not type-check
- A running `ng serve` keeps serving the old `@repo/shared-types` after a schema change — restart it
- CDK's overlay keyboard dispatcher listens on `<body>`, not `document`
- Overriding a `--mat-sys-*` role needs source order, not higher specificity
- A CSS variable that was never declared fails silently, taking its whole declaration with it
- jsdom cannot compute a `border` shorthand that holds a `var()`
- Class names are not stable in a bundled Angular spec
- A spec that reads a file must resolve it from `process.cwd()`, declare `@types/node`, and run from `apps/web`

## [Deployment / Nginx / Build](corner-cases/deploy-build.md)

- nginx serves `manifest.webmanifest` as `application/octet-stream`
- The Angular service worker serves `index.html` for `/api/**` navigations
- `ngsw-worker.js` and `ngsw.json` must not be cached by the web server
- SPA history fallback can mask a genuinely missing static asset as a 200
- `pnpm update-packages` (`ncu -u`) will happily jump to a release candidate or an unsupported major
- An app that uses `createZodDto` must declare `nestjs-zod` itself — pnpm does not hoist `packages/shared`'s dependencies
- `pnpm lint` at the root rewrites the NestJS apps' sources
- PM2 applies an `env_<name>` block only when `--env <name>` is passed — and the shared env file must not win over `PORT`/`NODE_ENV`
- An empty optional environment variable is not "absent" — it fails validation

## [Testing](corner-cases/testing.md)

- `apps/auth`'s `test:integration` couldn't load `@repo/testing-utils` at all — pure-ESM `@faker-js/faker` under a plain CommonJS Jest config
- A suite that imports app source can't use the ESM-mode Jest config — `require(esm)` cycle on `@repo/shared-types`
- `Nest can't resolve ClsService` in an ESM-mode Jest suite — import it from `@repo/shared`
- `jest.setup.ts` `override: true` silently re-points `globalSetup`'s container URLs at localhost
- `apps/web`'s Angular CLI refuses to run under the shell's default active Node version
- A `new Date()` inside a fixture builder makes the spec flaky
- A DB-level FK to the authenticated user's id needs a real row — `FakeAuthGuard` fakes only the identity
- `jest` is not a global in `apps/auth`'s e2e suites — they run as native ESM
