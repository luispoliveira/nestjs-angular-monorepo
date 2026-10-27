# Design

## Context

See proposal.md (Why) and the two delta specs (`customer-management`, `pii-field-encryption`) for the required behaviour. Current state that shapes the approach:

- `apps/api` already registers `MicroserviceAuthGuard` and `RolesGuard` as `APP_GUARD`. Authentication (bearer or `better-auth.session_token` cookie, see `ContextUtil.extractToken`) and `@Roles()` checks need no new wiring. URI versioning defaults to `1`, so routes land on `/api/v1/...`.
- `EncryptionService` (`packages/shared/src/encryption`) already exposes `encrypt` (AES-256-GCM, random IV), `decrypt` and `blindIndex` (HMAC-SHA256), and loads `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_HMAC_KEY` from `ConfigService`. No app provides it yet.
- `LoggingInterceptor` persists sanitized request **and** response bodies to Mongo through `SanitizeUtil`, whose `SENSITIVE_KEYS` list has no NIF key. pino redacts only fixed `req.body.*` password paths.
- `paginationSchema` has a free-form `sortBy: z.string()`. `paginatedSchema()` and `PaginatedUtil.getPaginatedResponse()` already produce the shared `{ items, meta }` shape.
- Prisma columns are camelCase (no field-level `@map`). The generator is `prisma-client` on ^7.10, which is past the 7.4 release that introduced the `partialIndexes` preview.
- `apps/web` has no `HttpClient` provider. Every data call today goes through `AUTH_CLIENT`. `proxy.conf.json` forwards `/api` to `apps/api` in dev, and nginx does the same in prod, so `/api` is same-origin and the session cookie is sent automatically.
- `DatabaseSeederService` runs on every `apps/api` boot, and `packages/database` cannot import `@repo/shared` (`shared` depends on `database`).

## Goals / Non-Goals

**Goals:**
- A slice whose file layout is the pattern to copy: one Nest feature module, one shared-types schema file, one Angular feature folder.
- DB-enforced invariants where the DB can enforce them (NIF uniqueness), app code elsewhere.
- Removable by deleting the `customers/` folders, the schema file exports, the model and its migration.

**Non-Goals:**
- A generic "encrypted field" abstraction (Prisma extension, decorator). There is one field, so explicit calls in the service are enough. The follow-up generator change can extract an abstraction if a second field appears.
- Full-text or trigram search. `ILIKE '%term%'` has no index support, which is acceptable for backoffice-sized tables (see Risks).
- Demo seed data (see proposal Non-goals).

## Decisions

### D1 — Data model (`packages/database`)

```prisma
generator client {
  // ...existing fields
  previewFeatures = ["partialIndexes"]
}

model Customer {
  id        String    @id @default(cuid())
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  name           String
  email          String?
  notes          String?
  taxIdEncrypted String?  // base64(iv || tag || ciphertext)
  taxIdHash      String?  // HMAC-SHA256 hex of the normalized NIF

  @@unique([taxIdHash], where: { deletedAt: null })
  @@index([deletedAt, createdAt])
  @@map("customer")
}
```

- The partial unique index implements "unique among active customers" (spec), and its NULL semantics make an absent NIF never collide.
- `@@index([deletedAt, createdAt])` serves the default listing (`deletedAt IS NULL ORDER BY createdAt DESC`).
- Migration: `pnpm db:migrate --name add_customer`, a new migration and never an edit of `init`.
- *Alternative:* raw `CREATE UNIQUE INDEX ... WHERE "deletedAt" IS NULL` hand-written in the migration SQL. Rejected as the default because the schema would not know about the index, and the next `prisma migrate dev` would detect drift and try to drop it. It stays the documented fallback if the preview is removed.
- *Alternative:* app-level `findFirst` before insert. Racy, rejected (spec requires correctness under concurrency).

### D2 — Shared schemas (`packages/shared-types/src/schemas/customer.schema.ts`)

- `normalizeNif(input: string): string` strips whitespace and an optional case-insensitive `PT` prefix. `isValidNif(canonical)` checks for exactly 9 digits plus the mod-11 check digit (weights 9..2; `check = 11 - sum % 11`, and `10`/`11` map to `0`).
- `nifSchema = z.string().transform(normalizeNif).refine(isValidNif, 'Invalid NIF')`. The browser form and the API DTO both go through it, which satisfies the "identical normalization" spec requirement by construction.
- `customerSchema` (response): `id`, `name`, `email: nullable`, `taxId: nullable`, `notes: nullable`, `createdAt`/`updatedAt` as the existing date schema. Uses `.meta({ id: 'Customer' })`.
- `createCustomerSchema`: `name` trimmed 1–200, `email: z.email().optional()`, `taxId: nifSchema.optional()`, `notes: max(2000).optional()`. Uses `.meta({ id: 'CreateCustomer' })`.
- `updateCustomerSchema`: every field optional, and `email`/`taxId`/`notes` also accept `null` (clear). Uses `.meta({ id: 'UpdateCustomer' })`.
- `customerListQuerySchema = paginationSchema.extend({ sortBy: z.enum(['name','email','createdAt','updatedAt']).default('createdAt'), sortOrder: …default('desc'), search: z.string().trim().optional() })`, **without** a root `.meta({ id })`. Same reason as the comment on `paginationSchema`: a root id on a query DTO breaks Swagger generation.
- `customersListResponseSchema = paginatedSchema(customerSchema)`.
- The generic `paginationSchema` stays untouched. Narrowing happens per resource.

### D3 — API module (`apps/api/src/customers/`)

```
customers/
  customers.module.ts      providers: CustomersService, EncryptionService
  customers.controller.ts  @Controller('customers')
  customers.service.ts
  customers.dto.ts         createZodDto(...) wrappers of the shared schemas
```

| Method | Path | Roles | Success | Errors |
|---|---|---|---|---|
| GET | `/api/v1/customers` | any authenticated | 200 `{items, meta}` | 401, 400 |
| GET | `/api/v1/customers/:id` | any authenticated | 200 | 401, 404 |
| POST | `/api/v1/customers` | `ADMIN` | 201 | 401, 403, 400, 409 |
| PATCH | `/api/v1/customers/:id` | `ADMIN` | 200 | 401, 403, 400, 404, 409 |
| DELETE | `/api/v1/customers/:id` | `ADMIN` | 204 (`@HttpCode(204)`) | 401, 403, 404 |

- Authorization: `@Roles(RoleEnum.ADMIN)` on the three write handlers only. Reads rely on the global `MicroserviceAuthGuard`. No new guards, and `role-based-authorization` semantics are unchanged.
- Responses go through `@ZodSerializerDto(CustomerDto)` (global `ZodSerializerInterceptor`), so `taxIdEncrypted`/`taxIdHash` can never leak even if the mapper regresses.
- `CustomersModule` is imported in `AppModule`. The `AppController` hello route stays.

### D4 — Service behaviour (`apps/api`)

- **Encrypt on write:** if `taxId` is a string, set `taxIdEncrypted = encrypt(nif)` and `taxIdHash = blindIndex(nif)`. If it is `null`, set both to `null`. If it is `undefined`, leave them untouched. The value is already normalized by the DTO.
- **Decrypt on read:** a single `toResponse(row)` maps `taxIdEncrypted → taxId` (decrypt or `null`).
- **Soft delete:** every query includes `deletedAt: null`. Update/delete use `updateMany({ where: { id, deletedAt: null } })`, and `count === 0` raises `NotFoundException`, which avoids a separate find. Update then re-reads the row to return it.
- **Uniqueness:** no pre-check. A Prisma `P2002` on create/update is mapped to `ConflictException` (409). That is race-safe because the index decides.
- **List:** `where = { deletedAt: null, OR? }`. With a non-empty `search`, `OR` contains `name`/`email` `contains` + `mode: 'insensitive'`, plus `{ taxIdHash: blindIndex(normalizeNif(search)) }` only when `isValidNif(normalizeNif(search))`. `findMany` + `count` run in one `$transaction`, then `PaginatedUtil.getPaginatedResponse`.
- *Alternative:* a Prisma client extension that encrypts transparently. Rejected for one field (Non-Goals). Explicit code is what a reader copying the slice needs to see.

### D5 — Log redaction (`packages/shared`)

- Add `'taxid'` to `SENSITIVE_KEYS` in `SanitizeUtil`. It already lowercases keys and recurses, so it covers request bodies and `items[].taxId` in list responses written by `LoggingInterceptor`.
- Add `'req.body.taxId'` to pino's `redact.paths`.
- Logged URLs: `SanitizeUtil.sanitizeUrl()` redacts the value of every query parameter listed in `SENSITIVE_QUERY_PARAMS` (`search`). It is applied to the `LoggingInterceptor` `url` field, pino's `req` serializer and `AllExceptionFilter`'s log lines. A NIF search sends the plaintext in the query string, and search terms in general may be names or emails. Found during the manual smoke test. The same function also redacts the `path` echoed in `AllExceptionFilter` error *responses*. A runtime check showed any error (even a 401) returned the full `?search=<nif>` to the client. Access logs of nginx or another proxy are outside the app and out of scope.
- This is a key-name rule. Any future field named `taxId` in any app is redacted too, which is the intended default for a template. Other PII fields added later must be appended to the same list. This is called out in the removal/usage note.

### D6 — Configuration (`apps/api`, `scripts/setup.mjs`)

- `apiEnvSchema` adds `FIELD_ENCRYPTION_KEY: z.string().min(1)` and `FIELD_ENCRYPTION_HMAC_KEY: z.string().min(1)`. A missing value fails Zod env validation at boot and names the variable. The 32-byte length check stays in `EncryptionService.loadKey`, which already throws with the required length, and it runs at module init, so it is still a boot failure.
- `apps/api/.env.example` gets placeholder lines. `scripts/setup.mjs` replaces them with `randomBytes(32).toString('base64')` (two independent values) when generating `apps/api/.env`, the same way it already generates the better-auth secret.
- `apps/api/.env.test` (new, for the integration suite) holds fixed test-only keys.

### D7 — Web data access (`apps/web`)

- Add `provideHttpClient(withFetch())` to `app.config.ts`. This is the first `apps/api` consumer. `HttpClient` gives `HttpErrorResponse.status` for the 409 mapping and `provideHttpClientTesting` for specs, with no new dependency.
- `features/customers/customers.api.ts`: an injectable `CustomersApi` with `list(query)`, `create`, `update`, `remove`. It wraps `firstValueFrom(http…)` and **parses every response** through the shared response schemas (the D6 network-boundary rule of the Angular migration). It uses `appConfig.apiUrl` (`/api`) + `/v1/customers`. It has two consumers (page and form dialog), which justifies the class.
- Query keys: `['customers', 'list', query]`. Mutations invalidate `['customers']`.

### D8 — Web UI (`apps/web/src/app/features/customers/`)

```
customers/
  customers.ts / .html / .scss / .spec.ts      page: table, search (debounced), paginator
  customer-form-dialog/                        one dialog for create + edit (data: Customer | null)
  customers.api.ts / .spec.ts
```

- Route: `{ path: 'customers', loadComponent: … }` as a child of the shell. The parent `authGuard` gates it, and there is no `adminGuard` because reading is allowed for all authenticated users.
- Nav: an entry in the `Main` group, `{ label: 'Customers', path: '/customers', icon: 'contacts', adminOnly: false }`.
- Write controls render only when `session.user()?.role === RoleEnum.ADMIN`. The server still enforces this; hiding is UX only.
- The form uses `zodValidator(createCustomerSchema / updateCustomerSchema)`. A 409 sets `taxId.setErrors({ conflict: 'NIF already in use' })` and keeps the dialog open. Other errors go to `MatSnackBar` and the dialog stays open.
- Delete confirmation reuses `features/users/confirm-dialog`. This couples to the users feature, not the other way round, so deleting the slice never touches users.

### D9 — Tests (SDD order: spec → tests → code)

| Level | Where | Covers |
|---|---|---|
| unit | `packages/shared-types` | `normalizeNif`, `isValidNif`, schema accept/reject (incl. `sortBy` allow-list, `take` max) |
| unit | `packages/shared` | `SanitizeUtil` redacts `taxId` (nested in `items[]`) |
| unit | `apps/api` | service (mocked `DatabaseService`/`EncryptionService`): encrypt/clear/keep, P2002→409, 404 on deleted, search OR-building. Controller `@Roles` metadata on writes only |
| integration | `apps/api/test/customers.integration.ts` (testcontainers, new `jest-integration.json` + `jest.setup.ts` mirroring `apps/auth`, but with CommonJS test files plus the `--experimental-vm-modules` flag, because the ESM mode hits a `require(esm)` cycle when importing app source; see CORNER_CASES) | real Postgres + real `EncryptionService`, HTTP via supertest, `MicroserviceAuthGuard` overridden by a fake that sets `request.user` with a role. Covers 401/403, 409 incl. concurrent creates, reuse after delete, NIF search, no plaintext in the row |
| unit | `apps/web` (`ng test`) | page shows/hides write controls by role; dialog field errors, 409 → `taxId` conflict; `CustomersApi` parses and rejects malformed responses |
| helpers | `packages/testing-utils` | `createCustomer()` factory (takes an optional `EncryptionService`-compatible encrypt/hash pair). `truncateDatabase` deletes `customer` |

## Risks / Trade-offs

- [`partialIndexes` is a preview feature] → One index, covered by the integration test (409 + reuse after delete). Fallback to raw migration SQL documented in D1.
- [`ILIKE '%term%'` scans the table] → Acceptable at backoffice scale. Upgrade path: `pg_trgm` GIN index on `name`/`email` when listing becomes slow.
- [Key loss or change makes NIFs unreadable and unsearchable] → Fail-fast at boot. Usage note states keys must be backed up and that rotation is not supported.
- [`taxId` redaction is name-based] → A field named differently would not be redacted. The usage note says to append new PII keys to `SENSITIVE_KEYS` and pino `redact.paths`.
- [Full NIF returned to every authenticated reader] → It matches the decided authorization (read = authenticated). Masking for non-admins is a possible later change and is not specified here.
- [Reusing `features/users/confirm-dialog`] → A one-directional coupling. If users is ever removed, move the dialog to a shared folder.

## Migration Plan

1. Set `FIELD_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_HMAC_KEY` in each `apps/api` environment **before** deploying (boot fails without them).
2. Deploy: `prisma migrate deploy` applies `add_customer`, an additive change (new table plus indexes), so no existing data is touched.
3. Rollback: redeploy the previous release. The extra table is harmless. To remove it fully, add a new migration that drops `customer` rather than editing the applied one.

**Removing the slice from a new project** (the README section the tasks add): delete `apps/api/src/customers/`, `apps/web/src/app/features/customers/`, `customer.schema.ts` and its export, the route and nav entry, the `Customer` model, the `CustomersModule` import, the factory and the truncate line. Then create a new migration dropping the table (or, on a fresh project with no applied migrations, delete the `add_customer` migration folder). Keep the encryption keys and the redaction keys if any PII remains.
