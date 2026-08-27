import { baseEnvSchema } from '@repo/shared';
import z from 'zod';

export const authEnvSchema = baseEnvSchema.extend({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(8),
  UI_URL: z.url().optional(),
  CORS_ORIGIN: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;
