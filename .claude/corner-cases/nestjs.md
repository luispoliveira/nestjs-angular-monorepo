# Corner cases — NestJS / SharedModule

## Sentry tracing silently records nothing unless Sentry initialises before every other import

**Symptom:** errors reach Sentry, but with `SENTRY_TRACES_SAMPLE_RATE` above 0 no HTTP/Postgres/Redis spans ever appear.

**Cause:** Sentry (v11 is channel-based, earlier majors used OpenTelemetry) instruments a module *when it loads*. Calling `SentryUtil.init()` inside `bootstrap()` is too late: by then `main.ts`'s own imports (`@nestjs/*`, the `@repo/shared` barrel, `./app.module`) have already loaded the whole graph. `node --require ./instrument` is no longer an option either, because v11 dropped it.

**Fix:** each app's `src/instrument.ts` is the first import of `main.ts` and loads `SentryUtil` from the `@repo/shared/sentry` subpath, which pulls in neither Nest nor the barrel. Two follow-on gotchas:
- **`.env` is not loaded yet.** `ConfigModule` only loads `.env` when `AppModule` is evaluated, so `SentryUtil.init` reads `.env` itself with `util.parseEnv`; process env wins.
- **Do not use `process.loadEnvFile` here.** It writes to the host process's env, which Jest's sandboxed `process.env` never sees, so it cannot be unit-tested.

Each app has a spec asserting that `./instrument` stays the first import.

Two more things surfaced while smoke-testing against a fake ingest endpoint:
- **Tags no longer reach spans.** Sentry v11 streams spans by default (envelope items of type `span`, not `transaction`), and streamed spans carry only attributes. `initialScope.tags` still tag error events, but the `app` label on traces needs `Sentry.getGlobalScope().setAttributes({ app })`.
- **Probe paths include the prefix.** Every app sets `globalPrefix: 'api'`, so the real paths are `/api/health/*` and `/api/metrics`. The Sentry sampler matches `SILENT_PATHS` at segment boundaries. pino's `autoLogging.ignore` compares exactly and therefore never matches: probes are still logged.

## `AllExceptionFilter` nests a custom exception's payload under `.message`

`throw new UnprocessableEntityException({ message, violations })` reaches the client as `{ statusCode, timestamp, path, message: { message, violations }, correlationId }`, because the filter (`packages/shared/src/filters/http-exception.filter.ts`) sets `message` to `exception.getResponse()`. Read extra fields from `body.message.<field>`, never `body.<field>`. A built-in exception thrown with a plain string, such as `ConflictException('NIF already in use')`, nests one level more: Nest's `getResponse()` is `{ message, error, statusCode }`, so the text is at `body.message.message`. A bare `HttpException('x', 404)` keeps `message` a string.

## `apps/*` cannot import each other's `src/` — shared domain logic belongs in `packages/shared`

Each NestJS app is its own deployable and has its own build, so one app cannot import another's `src/`. If a design has a cron job (`apps/cron`) or a notification handler (`apps/notifications`) calling "the same logic" a REST module in `apps/api` implements, put that logic in `packages/shared` from the start, or it has to be moved there later. Services only the api pipeline uses stay in `apps/api`.

## Global guard registration order is execution order

`APP_GUARD` providers run in registration order. `RolesGuard` reads `request.user`, which `MicroserviceAuthGuard` writes, so `apps/api/src/app.module.ts` registers the auth guard first; swapped, every `@Roles()` route is refused. `AuditContextGuard` must precede both, so a later guard's 401/403 still finds the `@Audit` metadata on the request. A unit spec with a hand-built `ExecutionContext` cannot catch an ordering mistake: `apps/api/src/app.module.spec.ts` reads the module's `providers` metadata and pins the order.

## A literal route segment must be declared before a `:param` route that would capture it

Nest matches routes in declaration order, not by specificity. In `CustomersController`, a new `@Get('export')` declared **after** `@Get(':id')` is never reached: `GET /customers/export` is captured as `id = 'export'` and answers a confusing 404 "customer not found". Declare the literal route first. Only segments competing for the same position collide (`:id/notes` and `:id` do not).

## A file endpoint must not return an object, or `LoggingInterceptor` persists the file

`LoggingInterceptor` (`packages/shared/src/interceptors/logging.interceptor.ts`) sanitises and writes the response body to the Mongo `Log` whenever the handler's result is an object — and a `StreamableFile` or a `Buffer` is an object. A **text** file returns a plain string with headers set through `@Res({ passthrough: true })`. A **binary** file cannot be a string: take `@Res()` without passthrough and `res.send(buffer)`, so the handler returns `undefined`. Cover it with a test that the file never reaches the request log.

## `ConfigModule.forRoot()` reads the environment when `AppModule` is imported — an integration suite cannot set an env var in `beforeAll`

`SharedModule.register()` runs at import time, so `process.env.X = …` in a suite's `beforeAll` is too late and a Zod default (or a missing-variable error) wins first. Per-suite env goes in the `setupFiles` entry, `apps/api/test/jest.setup.ts`, which runs before each test file imports anything — that is where `VAPID_PUBLIC_KEY` gets its test value. `process.env.X ??= …` there keeps a value that a real `.env.test` already declares.

## A file read at runtime must be listed in `nest-cli.json` `assets`, or it is missing from `dist`

A module that reads a non-TypeScript file when it loads (an email template, a logo, a SQL file) works under Jest, which runs from `src/` where the file sits, so every spec passes. `nest build` compiles only `.ts`: unless `compilerOptions.assets` in the app's `nest-cli.json` includes the file, it is absent from `dist/` and the app fails to boot in production with `ENOENT`. Add an `include` for each new asset, then check with `pnpm --filter <app> build` followed by `find apps/<app>/dist -name '<file>'`.
