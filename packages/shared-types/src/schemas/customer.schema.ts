import z from 'zod';
import { DateToISOString } from './date.schema.js';
import { paginatedSchema } from './paginated.schema.js';
import { paginationSchema } from './pagination.schema.js';

const NIF_WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Canonical form of a Portuguese NIF: whitespace and an optional
 * case-insensitive `PT` prefix removed. The API and the browser both run
 * this before validating, encrypting or blind-indexing, so equivalent
 * notations always hash to the same index (pii-field-encryption spec).
 */
export function normalizeNif(input: string): string {
  return input.replace(/\s+/g, '').replace(/^pt/i, '');
}

/** 9 digits + mod-11 check digit (a computed 10 or 11 maps to 0). */
export function isValidNif(canonical: string): boolean {
  if (!/^\d{9}$/.test(canonical)) return false;
  const digits = [...canonical].map(Number);
  const sum = NIF_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i]!, 0);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === digits[8];
}

export const nifSchema = z
  .string()
  .transform(normalizeNif)
  .refine(isValidNif, 'Invalid NIF');

export const customerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    taxId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: DateToISOString,
    updatedAt: DateToISOString,
  })
  .meta({ id: 'Customer' });

export type Customer = z.infer<typeof customerSchema>;

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name must be at most 200 characters');
const emailSchema = z.email('Invalid email address');
const notesSchema = z.string().max(2000, 'Notes must be at most 2000 characters');

export const createCustomerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    taxId: nifSchema.optional(),
    notes: notesSchema.optional(),
  })
  .meta({ id: 'CreateCustomer' });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** `null` clears an optional field; an omitted field is left unchanged. */
export const updateCustomerSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.nullable().optional(),
    taxId: nifSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .meta({ id: 'UpdateCustomer' });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const CUSTOMER_SORT_FIELDS = [
  'name',
  'email',
  'createdAt',
  'updatedAt',
] as const;

// No root `.meta({ id })` — same reason as `paginationSchema`: a query DTO
// with a root id breaks Swagger generation. `sortBy` is narrowed to an
// allow-list so arbitrary strings never reach Prisma's `orderBy`.
export const customerListQuerySchema = paginationSchema.extend({
  sortBy: z.enum(CUSTOMER_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().optional(),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customersListResponseSchema = paginatedSchema(customerSchema);

export type CustomersListResponse = z.infer<typeof customersListResponseSchema>;
