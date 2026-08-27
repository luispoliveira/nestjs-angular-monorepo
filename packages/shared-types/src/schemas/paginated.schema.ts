import z from 'zod';

/**
 * Mirrors packages/shared's PagedMetaSchema so a future apps/api endpoint's
 * response and the frontend that consumes it describe pagination the same
 * way. Framework-agnostic (no nestjs-zod) since this package is also
 * consumed by the browser.
 */
export const pagedMetaSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .meta({ id: 'PagedMeta' });

export type PagedMeta = z.infer<typeof pagedMetaSchema>;

/**
 * Wraps an item schema in the { items, meta } shape used by every paginated
 * apps/api response, so every paginated endpoint shares one contract.
 */
export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    meta: pagedMetaSchema,
  });
}
