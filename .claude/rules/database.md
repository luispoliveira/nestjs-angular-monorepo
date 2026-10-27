---
paths:
  - "packages/database/**"
---

## Database Conventions (`packages/database`)

- Prisma 7, generator output: [packages/database/generated/prisma/](../../packages/database/generated/prisma/) (re-exported from the `@repo/database` barrel).
- Driver adapter: `PrismaPg` (not the default TCP). `DatabaseService` wraps `PrismaClient` with `DATABASE_URL` from `ConfigService`.
- Schemas live in [packages/database/prisma/](../../packages/database/prisma/):
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
- Seeding runs in `DatabaseSeederService.onModuleInit()` ([packages/database/src/database-seeder.service.ts](../../packages/database/src/database-seeder.service.ts)). Run with `pnpm db:seed`.

### MongoDB — logs/audit only

`MongoModule` (in `@repo/shared`) provides `Log` (HTTP request/response) and `EmailLog` schemas, both with a 30-day TTL. Write via `MongoService` — never store business data in Mongo and never inject Mongoose models for feature code.
