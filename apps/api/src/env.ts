import { baseEnvSchema } from '@repo/shared';
import z from 'zod';

export const apiEnvSchema = baseEnvSchema.extend({
  CORS_ORIGIN: z.string().min(1),
  // pii-field-encryption: base64 keys for EncryptionService (32-byte AES key
  // length is checked by EncryptionService at module init).
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  FIELD_ENCRYPTION_HMAC_KEY: z.string().min(1),
  // Web push: the public half of the VAPID key pair, handed to browsers so
  // they can subscribe. The private half lives in apps/worker only.
  VAPID_PUBLIC_KEY: z.string().min(1),
  // Days an audit event is kept before it expires (new events only).
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
