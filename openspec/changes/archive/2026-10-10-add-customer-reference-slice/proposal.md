# Proposal

## Why

The template's infrastructure (auth, queues, observability, CI) is mature, but nothing shows how a business feature is built end to end. `apps/api` has only a `Hello, world!` controller, `schema.prisma` has no application models, the shared `EncryptionService` is not used by any app, and `apps/web` defines `apiUrl: '/api'` without ever calling it. Teams starting backoffices from this template have to work out the conventions (soft delete, pagination, shared Zod schemas, role gates, PII at rest) on their own. This change adds a single reference vertical slice, `Customer`, that they can copy, and that they can delete in one pass.

## What Changes

- New `Customer` Prisma model with soft delete, plus its own migration and a test factory (`packages/database`, `packages/testing-utils`).
- Customer request/response/list-query schemas in `packages/shared-types`, including a Portuguese NIF validator and normalizer that the API and the browser share.
- New REST resource in `apps/api` under `/api/v1/customers` (URI versioning, default v1): list (paginated, sortable from an allow-list, searchable), get by id, create, update, soft delete.
- Authorization: any authenticated user can read. Create, update and delete require `RoleEnum.ADMIN`.
- The optional NIF is stored encrypted at rest (AES via `EncryptionService`), with a blind index used for exact-match search and for uniqueness among active customers. Creating or updating with a NIF that an active customer already holds is rejected with 409. Soft-deleting a customer frees its NIF.
- `apps/api` requires `FIELD_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_HMAC_KEY`. `scripts/setup.mjs` generates both.
- New `/customers` feature in `apps/web`: a paginated Material table with search, create/edit dialogs validated by the shared schemas, and a delete confirmation. Write actions are shown only to admins. This is the first `apps/web` feature that calls `apps/api` (same-origin `/api`).
- The slice is isolated in `customers/` folders and a dedicated migration, and a short removal note lists exactly what to delete.

## Capabilities

### New Capabilities

- `customer-management`: the customer resource. Its REST contract, authorization rules, list/search/sort/pagination behaviour, soft-delete semantics, NIF uniqueness among active customers, and the admin UI that consumes it.
- `pii-field-encryption`: how a personal-data field is protected at rest. Encryption, a normalized blind index for equality search and uniqueness, the plaintext never being persisted or logged, and the key configuration the app must provide at boot.

### Modified Capabilities

None. Env validation (`env-validation`) and role checks (`role-based-authorization`) are reused as already specified, and no requirement changes.

## Non-goals

- Browser e2e tests (Playwright). These are cross-cutting infrastructure and get their own change.
- Audit logging of admin actions. Planned as a follow-up change on top of this slice.
- A code generator that scaffolds new resources from this slice. Planned after the audit log.
- Encryption key rotation or re-encryption tooling (documented as a limitation).
- Domain events, queue jobs or notifications for customer changes.
- Changing the generic `paginationSchema` in `packages/shared-types`. The slice narrows `sortBy` locally instead.
- Demo seed data for customers: the seeder runs on every `apps/api` boot and `packages/database` cannot reach `EncryptionService` (dependency direction). Tests use the factory instead.
- Restoring (un-deleting) soft-deleted customers, and any UI listing deleted customers.

## Open questions

None open. Resolved during explore:

- Authorization: read for authenticated users, write for `ADMIN`.
- Search: one `search` term with partial match on name/email, plus an exact NIF match when the term is a valid NIF.
- NIF: optional, unique among non-deleted customers.
- Partial unique index: supported natively since Prisma 7.4 behind the `partialIndexes` preview feature (the repo is on ^7.10). The trade-off is recorded in design.md.
- Playwright: out of scope.

## Alternatives considered

- **`Customer` without encryption.** A smaller slice, but `EncryptionService` stays dead code and the most common backoffice compliance need (PII at rest) remains undemonstrated.
- **A neutral `Note`/`Task` domain.** Easier to discard, but less realistic for backoffices and has no natural PII field.
- **Generated OpenAPI client for `apps/web`.** Adds a codegen step and a dependency. The shared Zod schemas already give a typed contract, and the web parses responses through them.
- **App-level uniqueness check instead of a DB constraint.** Racy under concurrent creates. A partial unique index is enforced by PostgreSQL.

## Risks & Mitigations

- **`partialIndexes` is a preview feature.** Its syntax or behaviour could change in a later Prisma minor. Mitigation: a single index in a single model, covered by an integration test that asserts the 409 / re-use-after-delete behaviour. Falling back to raw SQL in the migration is documented in design.md.
- **Lost or changed encryption keys make existing NIFs unreadable and unsearchable.** Mitigation: keys are required at boot (fail fast). The removal/ops note states that keys must be backed up and are not rotatable in this change.
- **The NIF normalizer diverges between browser and API**, which would break search and uniqueness without any error. Mitigation: a single normalizer in `packages/shared-types`, imported by both sides and unit-tested.
- **Free-form `sortBy` being copied into Prisma `orderBy`.** Mitigation: the customer list query restricts `sortBy` to an enum, and the slice is the reference pattern.

## Impact

- `packages/database`: `schema.prisma` (new model, `partialIndexes` preview flag), new migration.
- `packages/shared-types`: new customer schemas, NIF validator/normalizer, exports.
- `packages/shared`: no behaviour change. `EncryptionService` gets its first consumer.
- `packages/testing-utils`: customer factory, truncation includes the customer table.
- `apps/api`: new `customers` module/controller/service, env schema adds two keys, `.env.example`.
- `apps/web`: new `features/customers`, route, shell nav entry, first `/api` data access.
- `scripts/setup.mjs`: generates the two encryption keys.
- New REST endpoints: `GET/POST /api/v1/customers`, `GET/PATCH/DELETE /api/v1/customers/:id`.
- No new runtime dependencies.
