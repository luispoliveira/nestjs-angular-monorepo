import { baseEnvSchema } from '@repo/shared';
import z from 'zod';

export const workerEnvSchema = baseEnvSchema
  .extend({
    CORS_ORIGIN: z.string().min(1),
    MAIL_PROVIDER: z.enum(['brevo', 'resend']).default('brevo'),
    // Only the active provider's key is required (see superRefine below).
    BREVO_API_KEY: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    FROM_EMAIL: z.email(),
    FROM_NAME: z.string().default(''),
    DEV_EMAIL: z.email().optional(),
  })
  .superRefine((env, ctx) => {
    const keyName =
      env.MAIL_PROVIDER === 'resend' ? 'RESEND_API_KEY' : 'BREVO_API_KEY';
    if (!env[keyName]) {
      ctx.addIssue({
        code: 'custom',
        path: [keyName],
        message: `${keyName} is required when MAIL_PROVIDER=${env.MAIL_PROVIDER}`,
      });
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
