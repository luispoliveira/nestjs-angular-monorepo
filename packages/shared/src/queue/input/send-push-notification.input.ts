import { createZodDto } from 'nestjs-zod';
import z from 'zod';

/**
 * Where a push opens the app: a path inside it, never another origin. A
 * leading `//` or `/\` is read by browsers as a protocol-relative URL, so
 * both are refused along with absolute URLs.
 */
const inAppPath = z
  .string()
  .startsWith('/')
  .refine((url) => !url.startsWith('//') && !url.startsWith('/\\'), {
    message: 'url must be a path inside the app',
  });

export const sendPushNotificationInputSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1),
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(300),
    url: inAppPath,
    /** A newer push with the same tag replaces the previous one on the device. */
    tag: z.string().min(1).max(64).optional(),
    correlationId: z.string().optional(),
  })
  .meta({ id: 'SendPushNotification' });

export class SendPushNotificationInput extends createZodDto(
  sendPushNotificationInputSchema,
) {}
