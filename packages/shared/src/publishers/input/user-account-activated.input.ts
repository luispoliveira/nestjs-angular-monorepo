import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const userAccountActivatedInputSchema = z
  .object({
    userId: z.string(),
    email: z.email(),
  })
  .meta({ id: 'UserAccountActivated' });
export class UserAccountActivatedInput extends createZodDto(
  userAccountActivatedInputSchema,
) {}
