import { z } from 'zod';
import { DateToISOString, NullableDateToISOString } from './date.schema.js';

export const baseEntitySchema = z.object({
  id: z.number().int().positive(),
  createdAt: DateToISOString,
  updatedAt: DateToISOString,
  deletedAt: NullableDateToISOString,
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  deletedBy: z.string().nullable().optional(),
});
