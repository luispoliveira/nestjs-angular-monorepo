import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const sendAccountInvitationEmailInputSchema = z
  .object({
    email: z.email(),
    invitationLink: z.url(),
    correlationId: z.uuid().optional(),
  })
  .meta({ id: 'SendAccountInvitationEmail' });

export class SendAccountInvitationEmailInput extends createZodDto(
  sendAccountInvitationEmailInputSchema,
) {}
