import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const userInvitedInputSchema = z
  .object({
    userId: z.string(),
    email: z.email(),
    invitationLink: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'UserInvited' });
export class UserInvitedInput extends createZodDto(userInvitedInputSchema) {}
