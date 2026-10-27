# Corner cases — Zod v4 / nestjs-zod / OpenAPI

## `.meta({ id })` does not name the OpenAPI component — the DTO class does

`createZodDto(schema)` registers the schema in `components.schemas` under the **class name**: `createCustomerSchema.meta({ id: 'CreateCustomer' })` wrapped as `class CreateCustomerDto` appears as `CreateCustomerDto`. Keep `.meta({ id })` (the project convention, it names the schema in Zod's registry), but remember that renaming a DTO class is a breaking change for anyone generating a client from the OpenAPI document.

## Response DTOs built on a schema with `DateToISOString` need `createZodDto(schema, { codec: true })`

`DateToISOString` (`packages/shared-types/src/schemas/date.schema.ts`) is a `z.codec`. Without `{ codec: true }` (as in `CustomerDto` in `apps/api/src/customers/customers.dto.ts`) the `Date`s Prisma returns are not encoded to ISO strings on serialization. The reverse also holds: a schema that describes an already-serialized payload uses `z.iso.datetime()` and must **not** use the codec, or it decodes the string back into a `Date`.

## Re-`.meta({ id })`ing an already-registered schema breaks it as a `@Query()` DTO — and the app won't boot

`paginationSchema.meta({ id: 'FindAllX' })` discards the new id and turns the schema root into `$ref: '#/$defs/Pagination'`. nestjs-zod cannot express a `$ref` root as query parameters, so `cleanupOpenApiDoc` throws `Query or url parameters must be an object type` inside `BootstrapUtil.setup` — a **boot failure**. Rule: a pagination-only query DTO uses `paginationSchema` bare; with filters use `paginationSchema.extend({ ... })` (a fresh, unregistered object, see `customerListQuerySchema`) and put `.meta` on that, never on a registered schema unchanged. The test suites stay green: the integration tests build the Nest app by hand and never run `BootstrapUtil.setup`, so only starting the app (`pnpm --filter api start`) proves a schema change did not break boot.

## `zodValidator()` reports a `z.union` failure once, at the union's path

The path-walk to the right `FormControl` works, even through a `FormArray`. But a union failure is reported a single time, at the union's own path, with only "Invalid input": the members' per-field errors sit in `issue.errors` and never reach `control.errors?.['zod']`, so the field shows a vague message. Once the form knows which variant it holds, validate against that member's schema, not the union.

## A `.refine()` predicate without `: boolean` narrows the output type

`z.number().refine((id) => id === 1)` makes TypeScript infer the callback as a type guard, so the output type narrows to the literal `1` and then fails against Prisma's `number` far away from the schema. Annotate the predicate: `.refine((id): boolean => id === 1, ...)`.

## `.pick()` and `.omit()` throw at runtime on an object schema carrying a `.refine()`

In Zod 4, `schema.pick({...})` and `schema.omit({...})` on an object schema with a refinement throw `.pick() cannot be used on object schemas containing refinements` — at runtime, when the module loads or the page renders, while `check-types` stays green. Build the narrower schema from `.shape` (`z.object({ name: schema.shape.name })`), or keep the plain field object (`const createXFields = z.object({...})`) and derive both the refined create schema and the narrower ones from it.
