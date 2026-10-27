# Tasks

## 1. Shared customer contract and NIF rules

- [x] 1.1 test(shared-types): packages/shared-types: write `src/schemas/customer.schema.spec.ts` covering `normalizeNif` (`"PT 123 456 789"`, `"pt123456789"`, `"123456789"` → `"123456789"`), `isValidNif` (valid checksum, wrong checksum, 8/10 digits, check digit 10/11 → 0), `createCustomerSchema` (missing name, name > 200, bad email, notes > 2000, invalid NIF rejected; valid body normalizes `taxId`), `updateCustomerSchema` (all optional, `null` accepted for email/taxId/notes), `customerListQuerySchema` (`sortBy=taxId` rejected, `take=101` rejected, defaults `createdAt`/`desc`/20, blank `search` trimmed), `customersListResponseSchema` (missing `meta.total` or item `id` rejected) — verify the suite fails because the module does not exist yet
- [x] 1.2 feat(shared-types): packages/shared-types: implement `src/schemas/customer.schema.ts` per design D2 (no root `.meta({ id })` on the list query schema) and export from `schemas/index.ts` — verify `pnpm --filter @repo/shared-types test` passes and `scripts/verify-single-zod-version.mjs` still passes
- [x] 1.3 Commit group 1 with `/commit`

## 2. Log redaction for protected fields

- [x] 2.1 test(shared): packages/shared: extend `utils/sanitize.util.spec.ts` so `taxId` is replaced by `[SANITIZED]` at the top level and inside `items[]`; add a `logging/pino.config` assertion that `req.body.taxId` is in `redact.paths` — verify the new cases fail
- [x] 2.2 feat(shared): packages/shared: add `'taxid'` to `SENSITIVE_KEYS` and `'req.body.taxId'` to pino `redact.paths` (design D5) — verify `pnpm --filter @repo/shared test` passes
- [x] 2.3 Commit group 2 with `/commit`

## 3. Customer persistence

- [x] 3.1 feat(database): packages/database: add `previewFeatures = ["partialIndexes"]` and the `Customer` model from design D1 to `prisma/schema.prisma`; run `pnpm db:migrate --name add_customer` against local Postgres — verify the generated `migration.sql` contains a `CREATE UNIQUE INDEX ... WHERE ("deletedAt" IS NULL)` on `taxIdHash` and that `pnpm db:generate && pnpm --filter @repo/database build` succeed (CORNER_CASES: rebuild after generate)
- [x] 3.2 test(testing-utils): packages/testing-utils: add `factories/customer.factory.ts` (`createCustomer(db, overrides, crypto?)`, where `crypto` provides `encrypt`/`blindIndex` for an optional `taxId`), export it, and add `DELETE FROM "customer"` to `truncateDatabase` before `user` — verify `pnpm --filter @repo/testing-utils build` succeeds
- [x] 3.3 Commit group 3 with `/commit`

## 4. API configuration and integration-test harness

- [x] 4.1 feat(api): apps/api: add `FIELD_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_HMAC_KEY` (`z.string().min(1)`) to `src/env.ts` and placeholder lines to `.env.example` — verify starting the API without either variable fails at boot with an error naming it
- [x] 4.2 chore(scripts): scripts/setup.mjs: replace both placeholders with independent `randomBytes(32).toString('base64')` values when writing `apps/api/.env` — verify running the script on a copy without `apps/api/.env` produces two distinct 44-char base64 values
- [x] 4.3 test(api): apps/api: add `test/jest-integration.json` and `test/jest.setup.ts` mirroring `apps/auth` (testcontainers `globalSetup`/`globalTeardown`, throw when `E2E_CONTAINERS_RUN_ID_ENV` is unset), `.env.test` with fixed test-only encryption keys, a `test:integration` script and `@repo/testing-utils` as a devDependency — verify `pnpm --filter api test:integration --passWithNoTests` starts and stops the containers
- [x] 4.4 docs: update `README.md` setup/env section with the two keys (backup required, no rotation) and the note that new PII keys must be appended to `SENSITIVE_KEYS` and pino `redact.paths` — verify both keys appear in README and in `apps/api/.env.example`
- [x] 4.5 Commit group 4 with `/commit`

## 5. Customers REST resource

- [x] 5.1 test(api): apps/api: write `src/customers/customers.service.spec.ts` with mocked `DatabaseService` and `EncryptionService`: create encrypts and hashes `taxId`; update with `taxId: null` clears both columns and with `taxId` omitted leaves them; Prisma `P2002` → `ConflictException`; update/delete with `count === 0` → `NotFoundException`; list builds `deletedAt: null`, insensitive name/email `OR`, adds the `taxIdHash` branch only for a valid NIF term, and returns `{ items, meta }`; responses never contain `taxIdEncrypted`/`taxIdHash` — verify the suite fails
- [x] 5.2 test(api): apps/api: write `src/customers/customers.controller.spec.ts` asserting `@Roles(RoleEnum.ADMIN)` metadata on create/update/delete and none on list/get, and `@HttpCode(204)` on delete — verify the suite fails
- [x] 5.3 feat(api): apps/api: implement `src/customers/{customers.module,customers.controller,customers.service,customers.dto}.ts` per design D3/D4 (`EncryptionService` provided in the module, `@ZodSerializerDto` on responses, `$transaction` for list + count) and import `CustomersModule` in `AppModule` — verify `pnpm --filter api test` passes and `/api/docs` lists the five customer operations
- [x] 5.4 test(api): apps/api: write `test/customers.integration.ts` (real Postgres + real `EncryptionService`, supertest, `MicroserviceAuthGuard` overridden by a fake that sets `request.user` from a test header). Cover: 401 without user; 403 for non-admin writes; non-admin reads; create → get round trip returns the normalized NIF; the DB row holds no NIF digits; duplicate NIF in another notation → 409; two concurrent creates with the same NIF → exactly one 201 and one 409; reuse after delete → 201; deleted customer → 404 on get/patch/delete and absent from the list and `meta.total`; `search` by partial name, by full NIF, and no match by partial NIF; `sortBy=taxId` → 400; the Mongo request log for a create shows `taxId` redacted — verify `pnpm --filter api test:integration` passes
- [x] 5.5 Commit group 5 with `/commit`

## 6. Customers admin UI

- [x] 6.1 test(web): apps/web: write `features/customers/customers.api.spec.ts` with `provideHttpClientTesting`: `list` calls `/api/v1/customers` with the query params and returns parsed data; a malformed list response rejects; create/update/remove hit the right method and path — verify the suite fails
- [x] 6.2 feat(web): apps/web: add `provideHttpClient(withFetch())` to `app.config.ts` and implement `features/customers/customers.api.ts` per design D7 — verify `pnpm --filter web test` passes for the API spec
- [x] 6.3 test(web): apps/web: write `features/customers/customer-form-dialog/customer-form-dialog.spec.ts` (invalid NIF shows a field error and blocks submit; a 409 keeps the dialog open with a `conflict` error on `taxId`; another error shows a snackbar and keeps the dialog open; edit mode pre-fills and sends only the changes) and `features/customers/customers.spec.ts` (admin sees create/edit/delete, non-admin sees none; delete only after confirm; a successful write invalidates `['customers']`; a load error renders no rows) — verify both suites fail
- [x] 6.4 feat(web): apps/web: implement `features/customers/customers.{ts,html,scss}` and `customer-form-dialog/` per design D8 (debounced search, `MatPaginator`, reuse `features/users/confirm-dialog`), add the `customers` child route under the shell and the `Customers` entry (`contacts` icon, `adminOnly: false`) in the `Main` nav group — verify `pnpm --filter web test` and `pnpm --filter web build` pass
- [x] 6.5 Commit group 6 with `/commit`

## 7. Removal note and end-to-end verification

- [x] 7.1 docs: add a "Reference slice: Customers" section to `README.md` that lists what the slice demonstrates and the exact removal steps from design.md's Migration Plan; append to `.claude/CORNER_CASES.md` (Database) the `partialIndexes` preview and the drift risk of hand-written partial indexes — verify every path listed in the removal steps exists
- [x] 7.2 test: run `pnpm build`, `pnpm lint`, `pnpm check-types` and `pnpm test` at the root — verify all exit 0
- [x] 7.3 test: manual smoke with `pnpm docker:up && pnpm dev`: as admin, create a customer with NIF `PT 123 456 789`, search it by `123456789`, edit it, try a duplicate NIF (form shows conflict), delete it, then recreate with the same NIF; as a non-admin user, open `/customers` and confirm read-only; in Mongo `logs`, confirm `taxId` is `[SANITIZED]` — record the results in the PR description
- [x] 7.4 Commit group 7 with `/commit`

## 8. Redact search terms from logged URLs (found in smoke test)

- [x] 8.1 test(shared): packages/shared: add `SanitizeUtil.sanitizeUrl` cases (redacts `search`, case-insensitive key, keeps path and other params, no query → unchanged), a pino `req` serializer case and an `AllExceptionFilter`/`LoggingInterceptor` case asserting the logged URL is redacted; extend `apps/api/test/customers.integration.ts` so a NIF search's Mongo request log has no NIF in `url` — verify the new cases fail
- [x] 8.2 fix(shared): packages/shared: add `SENSITIVE_QUERY_PARAMS = ['search']` and `SanitizeUtil.sanitizeUrl`, and apply it in `LoggingInterceptor`, pino's `req` serializer and `AllExceptionFilter` log lines (design D5) — verify `pnpm --filter @repo/shared test` and `pnpm --filter api test:integration` pass
- [x] 8.3 Commit group 8 with `/commit`

## Workflow follow-up

- Run `/opsx:verify` and then `/opsx:archive` after review.
- Follow-up changes: `add-admin-audit-log`, then `add-resource-generator`, building on this slice.
