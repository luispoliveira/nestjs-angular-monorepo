import z from 'zod';

const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof sortOrderSchema>;

// No `.meta({ id })` here: this schema is used directly (not just via
// `.extend()`) as a whole `@Query()` DTO, and giving a query-DTO's root
// schema an id makes nestjs-zod emit a single named `$ref` query parameter
// instead of exploding it into per-field parameters — a shape
// `cleanupOpenApiDoc` can't unwrap, crashing Swagger generation.
export const paginationSchema = z.object({
  skip: z.coerce.number().min(0).default(0),
  take: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.string().default('id'),
  sortOrder: sortOrderSchema.default('asc'),
});
