import { apiEnvSchema } from './env';

const validEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_HOST: 'localhost',
  MONGO_URI: 'mongodb://localhost:27017/db',
  CORS_ORIGIN: 'http://localhost:3000',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  FIELD_ENCRYPTION_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  VAPID_PUBLIC_KEY: 'BPublicKey',
};

describe('apiEnvSchema', () => {
  it('accepts a complete environment', () => {
    expect(apiEnvSchema.safeParse(validEnv).success).toBe(true);
  });

  it.each([
    'FIELD_ENCRYPTION_KEY',
    'FIELD_ENCRYPTION_HMAC_KEY',
    'VAPID_PUBLIC_KEY',
  ])('rejects a missing %s and names it in the error', (name) => {
    const env: Record<string, string> = { ...validEnv };
    delete env[name];
    const result = apiEnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(name);
  });
});
