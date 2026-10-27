import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const sendAccountActivatedEmailInputSchema = z
  .object({
    email: z.email(),
    correlationId: z.uuid().optional(),
  })
  .meta({ id: 'SendAccountActivatedEmail' });

export class SendAccountActivatedEmailInput extends createZodDto(
  sendAccountActivatedEmailInputSchema,
) {}
