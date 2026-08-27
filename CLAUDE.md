# CLAUDE.md

Guidance for Claude Code when working in this NestJS + Angular monorepo template.

---

## Stack Overview

- **Monorepo**: Turborepo + pnpm workspaces ([pnpm-workspace.yaml](pnpm-workspace.yaml), [turbo.json](turbo.json))
- **Backend**: NestJS 11 (TypeScript), microservices via Redis transport
- **Frontend**: Angular 22 (standalone components, signals) + Tailwind CSS v4 + Angular Material
- **Database**: PostgreSQL via Prisma 7 + `PrismaPg` adapter (primary), MongoDB via Mongoose (logs/audit only), Redis (cache/queues)
- **Auth**: `better-auth` + `@thallesp/nestjs-better-auth` — **never** add Passport/JWT
- **Validation**: Zod **v4** + `nestjs-zod` (`createZodDto`, `ZodValidationPipe`, `ZodSerializerInterceptor`) on the backend; the same Zod schemas drive Angular reactive-form validation via `zodValidator()` from `@repo/shared-types`
- **API contract**: REST (`apps/api`'s own controllers) for the frontend's own backend; `apps/web` never talks tRPC — that layer was removed in the Next.js → Angular migration
- **Queue**: `@nestjs/bullmq` (BullMQ) with Redis — **not** legacy Bull v4
- **Logging**: `nestjs-pino` + `nestjs-cls` for correlation IDs
- **Health**: `@nestjs/terminus` (`HealthController` registered globally by `SharedModule`)

Node `>=22`, pnpm `10.33.0` (see [package.json](package.json), [.nvmrc](.nvmrc)).

---

## Workspace Layout

```
apps/
  api/           # NestJS — REST HTTP gateway for the frontend's own backend
  auth/          # NestJS — authentication + session (better-auth)
  notifications/ # NestJS — notification delivery (email via Redis events)
  worker/        # NestJS — BullMQ worker processing email jobs
  cron/          # NestJS — scheduled jobs (@nestjs/schedule), health/metrics HTTP
  web/           # Angular — admin dashboard (standalone components, signals, Angular Material)
packages/
  database/      # Prisma client (PrismaPg adapter), DatabaseModule, seeders
  shared/        # Global NestJS infra: constants, abstracts, guards, interceptors,
                 # filters, publishers, queue, modules, utils, mongo, health,
                 # encryption (AES field crypto + blind index), interfaces
  shared-types/  # Zod v4 schemas + zodValidator() shared between apps/web and the NestJS apps
  mail/          # MailModule with Brevo provider
  testing-utils/ # Test factories, DB truncation, testcontainers e2e setup
  eslint-config/ # Shared ESLint configs
  typescript-config/ # Shared tsconfig bases
```

Internal packages are imported with the `@repo/` prefix:

```typescript
import { DatabaseService } from '@repo/database';
import {
  SharedModule,
  QUEUES,
  SERVICES,
  EVENT_PATTERNS,
  JOB_PATTERNS,
} from '@repo/shared';
import { RoleEnum, paginationSchema } from '@repo/shared-types';
```

---

## Commands

Always use **pnpm** (never npm/yarn). Tasks run through Turborepo.

| Command                               | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `pnpm dev`                            | Run all apps in dev mode                        |
| `pnpm build`                          | Build all apps + packages                       |
| `pnpm lint`                           | Lint all workspaces                             |
| `pnpm check-types`                    | Type-check all workspaces                       |
| `pnpm format`                         | Prettier on `**/*.{ts,tsx,md}`                  |
| `pnpm db:generate`                    | `prisma generate` (runs `@repo/database`)       |
| `pnpm db:migrate`                     | `prisma migrate dev`                            |
| `pnpm db:seed`                        | Run seeders in `packages/database/src/seeders/` |
| `pnpm docker:up` / `pnpm docker:down` | Local infra (Postgres, Mongo, Redis)            |

Always run `pnpm build` and the relevant tests/lint after code changes before claiming a task is done.

---

## Constants — Never Hardcode

All injection tokens, queue names, and message patterns live in [packages/shared/src/constants/](packages/shared/src/constants/) as `as const` objects. **Always import; never inline.**

| Constant             | Location                | Examples                                          |
| -------------------- | ----------------------- | ------------------------------------------------- |
| `SERVICES`           | `constants/services.ts` | `AUTH`, `NOTIFICATIONS`                           |
| `QUEUES`             | `constants/queues.ts`   | `EMAIL: 'email-queue'`                            |
| `EVENT_PATTERNS`     | `constants/events.ts`   | `USER_CREATED`, `USER_PASSWORD_RESET_REQUESTED`   |
| `MESSAGE_PATTERNS`   | `constants/events.ts`   | `AUTH_AUTHENTICATE`                               |
| `JOB_PATTERNS`       | `constants/jobs.ts`     | `SEND_WELCOME_EMAIL`, `SEND_PASSWORD_RESET_EMAIL` |
| `CLS_CORRELATION_ID` | `constants/cls.ts`      | `'correlationId'`                                 |

---

## NestJS Conventions (`apps/{auth,notifications,worker}`, `packages/{shared,mail,database}`)

### Module bootstrap

Every app `AppModule` **must** import `SharedModule.register()` first. It is `@Global()` and provides:

- `ConfigModule` (`.env`, `isGlobal: true`)
- `DatabaseModule` (Prisma via `PrismaPg`)
- `TerminusModule` (health)
- `MongoModule` (Mongoose — logs/audit only)
- `LoggerModule` (pino, pretty in dev, JSON in prod)
- `ThrottlerModule` (default 10 req / 60s per IP)
- `ClsModule` (correlation IDs)
- Global providers: `AllExceptionFilter`, `LoggingInterceptor`, `CorrelationInterceptor`, `ZodValidationPipe`, `ZodSerializerInterceptor`
- Global controller: `HealthController` exposing `GET /health/live`, `GET /health/ready`

### `main.ts`

Use `BootstrapUtil.setup(app, config)`. For microservice apps, attach Redis transport **before** `listen()`:

```typescript
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.connectMicroservice(MicroserviceUtil.getRedisOptions());
await BootstrapUtil.setup(app, {
  globalPrefix: 'api/my-service',
  useHelmet: true,
  enableVersioning: true,
  swagger: { path: 'docs' },
  cors: { origin: process.env.FRONTEND_URL },
  enableCookieParser: true,
});
await app.startAllMicroservices();
await app.listen(process.env.PORT ?? 3000);
```

`main.ts` is the **only** place where `process.env` may be read directly. Everywhere else: `ConfigService.getOrThrow(...)`.

### Validation (Zod v4)

- Build DTOs with `createZodDto` from `nestjs-zod`.
- Prefer schemas from `@repo/shared-types` when shared with the frontend.
- Use **Zod v4 APIs**: `z.email()` (not `z.string().email()`), `.meta({ id: 'SchemaName' })` for OpenAPI IDs.
- `ZodValidationPipe` + `ZodSerializerInterceptor` are global — do not register them manually.

```typescript
const CreateUserSchema = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    role: z.enum(['admin', 'user']),
  })
  .meta({ id: 'CreateUser' });

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

### Microservices (Redis)

- Inject service clients via `SERVICES` tokens.
- Register clients with `MicroserviceUtil.registerAuthService()` / `MicroserviceUtil.registerNotificationsService()`.
- Defaults: `Transport.REDIS`, `retryAttempts: 5`, `retryDelay: 3000`.
- Fire-and-forget → `@EventPattern(EVENT_PATTERNS.*)`. Request/response → `@MessagePattern(MESSAGE_PATTERNS.*)`.

### Publishers

Extend `BasePublisher` from `@repo/shared/abstracts` — correlation IDs propagate automatically via `ClsService`.

Prefer the pre-built `NotificationsPublisher` from `@repo/shared/publishers` instead of writing a custom one.

### Queues (BullMQ, `@nestjs/bullmq`)

> **Do not** install or import from legacy `bull` / `@nestjs/bull`. This project uses BullMQ.

- Register in feature modules: `QueueModule.registerQueues([QUEUES.EMAIL])`.
- Producers: extend `BaseProducer` (injects correlation ID into job data). Use the pre-built `EmailProducer` from `@repo/shared/queue` for email jobs.
- Consumers: `@Processor(QUEUES.EMAIL)` extending `WorkerHost`, with a single `process(job)` method that dispatches on `job.name` (`JOB_PATTERNS.*`) via `switch`.
- Failure handling: `@OnWorkerEvent('failed')` (reports to Sentry in `EmailConsumer`).
- Default job options: `attempts: 3`, exponential back-off from 2000 ms, `removeOnComplete: true`, `removeOnFail: 500`.

### Authentication

- All routes are protected by default — `APP_GUARD: AuthGuard` is set globally in the auth app.
- Use `@Public()` (from `@repo/shared/decorators`) to bypass.
- Use `@CurrentUser()` to extract `request.user`.
- For routes in microservice context, `MicroserviceAuthGuard` from `@repo/shared/guards` calls `MESSAGE_PATTERNS.AUTH_AUTHENTICATE` to validate the bearer token (header or `better-auth.session_token` cookie).
- **Never** add Passport strategies or custom JWT logic.

### Logging & errors

- Use NestJS `Logger` (backed by pino). Correlation IDs are auto-threaded.
- HTTP req/res logs are persisted to MongoDB by `LoggingInterceptor` (paths `/health`, `/metrics`, `/favicon.ico` are silenced).
- `AllExceptionFilter` returns `{ statusCode, timestamp, path, message, correlationId }`. Throw standard `NestJS` HTTP exceptions (`NotFoundException`, `BadRequestException`, …). `ZodValidationException` → 422.

---

## Angular Conventions (`apps/web`)

- **Standalone components** (no `NgModule`s) + signals for local/derived state + Tailwind v4 + Angular Material.
- Data fetching: `@tanstack/angular-query-experimental` (`injectQuery`/`injectMutation`), 60s default `staleTime`. `QueryClient` is provided once in `app.config.ts` via `provideTanStackQuery(createQueryClient())`.
- Forms: Angular reactive forms (`FormBuilder`/`FormGroup`) validated by `zodValidator(schema)` from `@repo/shared-types` — the same Zod schema the backend validates with. Field errors read from `control.errors?.['zod']` (a string).
- Network-boundary parsing: a query's `queryFn` throws on a better-auth `error`, then re-`parse()`s the response through its shared Zod response schema before returning it — never trust an unvalidated payload into a signal (design.md's `D6` in the Angular migration's archived openspec change).
- Theme: a `ThemeService` (signal-backed, persisted to `localStorage`) plus an inline pre-bootstrap script in `index.html` that applies the stored preference before Angular loads, avoiding a flash of the wrong theme. Toasts/snackbars: `MatSnackBar`.
- Routing: functional guards (`CanActivateFn`), never class-based guards. Protected routes await the session's first resolution (`SessionService.ready()`) before deciding — never render protected content against the session atom's still-loading initial value.

### Session and auth

```typescript
// Component
private readonly session = inject(SessionService); // signal-backed bridge over authClient.useSession
if (!this.session.isAuthenticated()) { ... }

// Guard
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  await session.ready();
  return session.isAuthenticated() ? true : inject(Router).parseUrl('/sign-in');
};
```

`AUTH_CLIENT` (an `InjectionToken` wrapping the vanilla `better-auth/client`) is the DI seam for testing — components inject `AUTH_CLIENT`, never `authClient` directly, so tests can substitute a fake client. **Never** write custom session/JWT logic.

For role checks: `session.user()?.role !== RoleEnum.ADMIN` (`RoleEnum` from `@repo/shared-types`).

### UI

- Angular Material owns component surfaces (dialogs, tables, menus, form fields); Tailwind utility classes own layout. When the two conflict on a Material component's own sizing, the fix goes in that component's SCSS as a plain (unlayered) rule — Material's injected CSS is not wrapped in Tailwind's `@layer utilities`, so an unlayered Tailwind class loses regardless of specificity.
- `MatDialog` for modals, `MatSnackBar` for toasts, `MatMenu` for action menus — do not hand-roll these.
- Icons: Material icon ligatures (`<mat-icon>name</mat-icon>`), not a separate icon package.

---

## Database Conventions (`packages/database`)

- Prisma 7, generator output: [packages/database/generated/prisma/](packages/database/generated/prisma/) (re-exported from the `@repo/database` barrel).
- Driver adapter: `PrismaPg` (not the default TCP). `DatabaseService` wraps `PrismaClient` with `DATABASE_URL` from `ConfigService`.
- Schemas live in [packages/database/prisma/](packages/database/prisma/):
  - `schema.prisma` — generator + datasource + application models.
  - `auth.prisma` — **owned by better-auth**. Do not edit directly; extend via better-auth's API.

### Model conventions

- PascalCase singular model names, snake_case table via `@@map`.
- Always include `id` (`String @id @default(cuid())`), `createdAt`, `updatedAt`.
- Prefer **soft deletes** — add `deletedAt DateTime?` and filter `deletedAt: null` in queries.
- `@@index` on every FK and frequently-queried column.

```prisma
model Post {
  id        String    @id @default(cuid())
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  title    String
  authorId String
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@map("post")
}
```

> `baseEntitySchema` in `@repo/shared-types` uses `id: z.number().int().positive()` — that's for API payload validation only and may not match the DB type. The Prisma model is the source of truth for persistence.

### Access

- Inject `DatabaseService` (do **not** inject `PrismaClient` directly). It is provided globally via `SharedModule` → `DatabaseModule`.
- For pagination, use `PaginatedUtil.getPaginatedResponse(items, total, skip, take)` from `@repo/shared` with `paginationSchema` from `@repo/shared-types` (`take` max 100, default 20).

### Migrations & seeders

- `pnpm db:migrate` (runs `prisma migrate dev`) with descriptive names: `add_post_soft_delete`, `create_booking_table`.
- **Never** use `prisma db push` outside local rapid iteration.
- Seeders implement `DatabaseSeeder` ([packages/database/src/seeders/](packages/database/src/seeders/)) and register in `DatabaseSeederService.onModuleInit()`. Run with `pnpm db:seed`.

### MongoDB — logs/audit only

`MongoModule` (in `@repo/shared`) provides `Log` (HTTP request/response) and `EmailLog` schemas, both with a 30-day TTL. Write via `MongoService` — never store business data in Mongo and never inject Mongoose models for feature code.

---

## Git Commits

Follow **Gitflow** for branching and **Conventional Commits** for messages. Full rules in [.github/git-commit-instructions.md](.github/git-commit-instructions.md).

### Branching

| Branch              | Base      | Merges into        | Use for                                                |
| ------------------- | --------- | ------------------ | ------------------------------------------------------ |
| `main`              | —         | —                  | Production releases — always tagged, always deployable |
| `develop`           | `main`    | —                  | Integration — latest completed development             |
| `feature/<name>`    | `develop` | `develop`          | New features (one branch per feature)                  |
| `release/<version>` | `develop` | `main` + `develop` | Release prep: bugfixes, version bumps only             |
| `hotfix/<name>`     | `main`    | `main` + `develop` | Urgent production fixes                                |
| `bugfix/<name>`     | `develop` | `develop`          | Non-urgent bug fixes                                   |

- **Never commit directly to `main` or `develop`** — always via PR.
- Use `--no-ff` merges to preserve branch topology.
- Tag every merge to `main` with semver: `v1.0.0`, `v1.2.3`.
- Delete branches after merge.

### Commit messages

- `<type>(<scope>): <imperative summary>` — subject ≤50 chars (hard cap 72), lowercase after colon, no trailing period.
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`.
- Scopes map to apps/packages: `auth`, `notifications`, `worker`, `web`, `api`, `database`, `shared`, `shared-types`, `mail`, `ci`, `docker`.
- Breaking changes: append `!` and add a `BREAKING CHANGE:` footer.
- Body explains **why**, not what. Wrap at 72 chars.
- **Do not** include AI attribution lines (no "Generated with...", "Co-authored by Claude/Copilot"), "as requested by...", or first-person pronouns.

---

## Corner Cases Memory

**Read [.claude/CORNER_CASES.md](.claude/CORNER_CASES.md) at the start of every task.**

It is a living log of non-obvious behaviours, gotchas, and edge cases discovered during development — organised by area (Zod, NestJS, Prisma, Angular, deployment, etc.). When you discover a new corner case that is not already there, append it to the relevant section. Keep each entry concise: one heading + a short description of the problem and the fix/workaround.

---

## Source-of-Truth Files

Detailed conventions referenced above live in the Copilot instruction files — read them when you need more depth than this summary:

- [.claude/CORNER_CASES.md](.claude/CORNER_CASES.md) — accumulated corner cases and gotchas
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — stack overview
- [.github/instructions/nestjs-conventions.instructions.md](.github/instructions/nestjs-conventions.instructions.md)
- [.github/instructions/angular-conventions.instructions.md](.github/instructions/angular-conventions.instructions.md)
- [.github/instructions/database-conventions.instructions.md](.github/instructions/database-conventions.instructions.md)
- [.github/git-commit-instructions.md](.github/git-commit-instructions.md)
- [README.md](README.md), [DEPLOY.md](DEPLOY.md), [DEPLOY-PM2.md](DEPLOY-PM2.md)

When these documents conflict with the summary here, **the source-of-truth file wins** — update this CLAUDE.md to match.
