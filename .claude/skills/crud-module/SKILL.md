---
name: crud-module
description: Scaffold a complete REST CRUD resource in apps/api following this repo's reference slice — Prisma model with soft delete, Zod contract in shared-types, module/controller/service, audited writes, plus unit and integration tests. Use when adding CRUD endpoints for a new business resource, or when asked to "create the CRUD API for X", "add endpoints for X", or "expose X over REST".
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Builds one REST resource in `apps/api`. The worked example is the **Customers** slice
(`apps/api/src/customers/`, `packages/shared-types/src/schemas/customer.schema.ts`,
`Customer` in `packages/database/prisma/schema.prisma`). Read it alongside this file; when
the two disagree, the code wins. The web screen (`apps/web/src/app/features/customers/`) is a
separate piece of work — see the README's "Reference slice: Customers" table.

## Before you start

Answer these, because they change the shape of the resource:

1. **Soft delete?** The convention is yes: `deletedAt DateTime?`, every read filters
   `deletedAt: null`, and `DELETE /:id` stamps it. Only skip it if the resource must never
   disappear, and then do not add a delete endpoint.
2. **Is there a unique business column** (like `Customer.taxIdHash`)? If so it needs a
   **partial** unique index (`@@unique([col], where: { deletedAt: null })`, the
   `partialIndexes` preview feature already enabled) so a deleted row frees its value, and the
   service maps a `P2002` to `409` (step 4).
3. **Does it hold personal data** (a tax id, a phone, free text about a person)? Then encrypt
   it with `EncryptionService`, blind-index it for exact search and keep it out of logs — copy
   `taxId` end to end, including the `SanitizeUtil` key and `pino` redact path. If not, skip all
   of that: a CRUD resource is only the plain columns.
4. **Who may write?** Reads are open to any authenticated user (the global
   `MicroserviceAuthGuard`); writes are `@Roles(RoleEnum.ADMIN)`. `RolesGuard` admits any
   authenticated caller on a route with **no** `@Roles`, so a write route that forgets the
   decorator is open to everyone.

## File layout

Flat, one directory per resource under `apps/api/src/`:

```
packages/database/prisma/schema.prisma                   model + migration
packages/shared-types/src/schemas/<resource>.schema.ts   contract, exported from schemas/index.ts
apps/api/src/<resources>/
  <resources>.module.ts
  <resources>.controller.ts
  <resources>.service.ts
  <resources>.dto.ts                  createZodDto classes
  <resources>.controller.spec.ts
  <resources>.service.spec.ts
apps/api/test/<resources>.integration.ts
```

Plural directory and class prefixes (`customers`, `CustomersService`), singular schema and
DTO names (`customerSchema`, `CreateCustomerDto`).

## Step 1 — the Prisma model and its migration

Follow `.claude/rules/database.md`: `id String @id @default(cuid())`, `createdAt`,
`updatedAt`, `deletedAt`, `@@map("snake_case")`, `@@index` on every foreign key and on the
default listing (`@@index([deletedAt, createdAt])`). Ids are strings, so route params take no
`ParseIntPipe`. Then the migration: `prisma migrate dev` cannot run non-interactively — see
`.claude/corner-cases/database.md` ("diff the schema instead"). A new table also needs a line in
`packages/testing-utils/src/helpers/truncate.ts` (children before parents) and, if the tests
need rows, a factory next to `customer.factory.ts`, exported from both `index.ts` files.

## Step 2 — the contract in `shared-types`

The shared Zod schemas drive both the API validation and the Angular forms, so they live here.

- `<resource>Schema` for the response (`DateToISOString` for timestamps), `.meta({ id })`.
- `create<Resource>Schema` and `update<Resource>Schema`: update is the create fields all
  `.optional()`, and a clearable column is `.nullable().optional()` (`null` clears, omitted leaves
  unchanged).
- `<resource>ListQuerySchema = paginationSchema.extend({ sortBy, sortOrder, search })`. **No
  `.meta({ id })` on it** (a root id breaks Swagger generation — corner case in `zod.md`), and
  narrow `sortBy` to an allow-list (`CUSTOMER_SORT_FIELDS`) so an arbitrary string never reaches
  Prisma's `orderBy`.
- `<resources>ListResponseSchema = paginatedSchema(<resource>Schema)`.

There are no audit-column fields in a request schema: attribution never comes from the body.

## Step 3 — DTOs

`<resources>.dto.ts`: one `createZodDto(schema)` class per request schema, and
`createZodDto(schema, { codec: true })` for the response classes (without `codec` a Prisma `Date`
is not encoded to an ISO string). The DTO **class name** is what names the component in OpenAPI,
not `.meta({ id })`.

## Step 4 — the service

Owns all persistence, existence and conflict rules. The parts to get right:

```ts
// findFirst + deletedAt: null — a soft-deleted row is indistinguishable from a missing one
const row = await this.db.customer.findFirst({ where: { id, deletedAt: null } });
if (!row) throw new NotFoundException('Customer not found');
```

- **Update and delete go through `updateMany({ where: { id, deletedAt: null } })` and check
  `count === 0` → `404`.** One atomic statement, so "invisible after delete" holds for read,
  update and delete alike, with no read-then-write race.
- **Unique violation:** wrap `create`/`update` and map `Prisma.PrismaClientKnownRequestError`
  with `code === 'P2002'` to `ConflictException`. With several unique indexes, tell them apart by
  `meta.driverAdapterError.cause.constraint.index` — `meta.target` is absent under `PrismaPg`.
- **Soft delete stamps, never deletes:** `data: { deletedAt: new Date() }`.
- **List:** one `where` shared by `findMany` and `count` inside `$transaction`, case-insensitive
  search with `mode: 'insensitive'`, then `PaginatedUtil.getPaginatedResponse(items, total, skip, take)`.
- A known ceiling goes in a `ponytail:` comment that names the upgrade path (as `searchFilters`
  does for `pg_trgm`), not in a bigger design.

## Step 5 — the controller

Translates HTTP into service calls: no database access, no business rules.

```ts
@Controller('customers')
export class CustomersController {
  @Get() @ZodSerializerDto(CustomersListDto) list(@Query() query: CustomerListQueryDto) {}
  @Post() @Roles(RoleEnum.ADMIN)
  @Audit('customer.create', { targetType: 'customer', fields: AUDITED_FIELDS })
  @ZodSerializerDto(CustomerDto) create(@Body() body: CreateCustomerDto) {}
  @Delete(':id') @Roles(RoleEnum.ADMIN) @HttpCode(204) remove(@Param('id') id: string) {}
}
```

- **Declare a literal route before a `:id` route** that would capture it (`@Get('export')`
  before `@Get(':id')`) — Nest matches in declaration order.
- **Audit every write** with `@Audit('<resource>.<verb>', { targetType, fields })`. The action
  must exist in `AUDIT_ACTIONS` in `packages/shared-types/src/schemas/audit.schema.ts`, and that
  file's spec lists the expected actions, so update both. `fields` are names only; events never
  hold values.
- Validation failures are `400` (the global `ZodValidationPipe`), via DTOs — no manual parsing.
- Throw standard Nest HTTP exceptions; `AllExceptionFilter` shapes the body and nests the
  payload under `.message` (corner case in `nestjs.md`).

## Step 6 — the module

```ts
@Module({ controllers: [CustomersController], providers: [CustomersService] })
export class CustomersModule {}
```

Import it in `apps/api/src/app.module.ts`. `SharedModule` is already global, so `DatabaseService`
is injectable. Export the service only if a sibling module composes it.

## Step 7 — unit tests

`apps/api` enforces an 80% coverage threshold, so both layers are required.

- **Service** (`Test.createTestingModule` with a mocked `DatabaseService`): per method the happy
  path; `404` on an unknown **and** on a soft-deleted id; `409` on create and on update;
  `deletedAt: null` present in every read filter; `deletedAt` stamped on delete; list and count
  sharing one `where`; and on every rejection assert the write **did not happen**
  (`expect(db.x.create).not.toHaveBeenCalled()`).
- **Controller:** construct it directly (`new CustomersController(mockService)`), assert only that
  each handler forwards its arguments to the right service method.

## Step 8 — integration test

`apps/api/test/<resources>.integration.ts`, modelled on `customers.integration.ts`: real
`SharedModule`, `FakeAuthGuard` (role from the `x-test-role` header) and the real `RolesGuard`,
against Testcontainers Postgres/Mongo/Redis. `truncateDatabase` in `beforeEach`. Cover: `401`
unauthenticated on **each** endpoint; `403` for a non-admin write and `200` for a non-admin read;
every success path; `404` unknown id; `409` duplicate (and a real concurrent race, since the
check is the database's); `400` for an invalid body; search hit and miss; the sort allow-list;
and the full soft-delete sequence (delete, then `404` on read, absent from the listing, `404` on
update, second delete `404`).

`FakeAuthGuard` fakes the identity but not a `user` row: any foreign key to the caller's id needs
the row created in `beforeEach` (see `push.integration.ts`).

## Verify before declaring done

```bash
pnpm --filter api check-types
pnpm --filter api test               # unit
pnpm --filter api test:cov           # must clear the 80% threshold
pnpm --filter api test:integration   # needs Docker; Testcontainers provisions its own databases
pnpm build
```

`test:integration` does not need `pnpm docker:up`. Then start the app once (`pnpm --filter api
start`): a schema that breaks OpenAPI generation passes every test and only fails at boot.

## Read also

`.claude/CORNER_CASES.md` (index) — `zod.md` (query DTOs and OpenAPI, `codec: true`),
`database.md` (P2002 under `PrismaPg`, migrations without a TTY, partial indexes), `nestjs.md`
(route order, guard order, the exception filter), `testing.md` (`FakeAuthGuard` and FK rows).
