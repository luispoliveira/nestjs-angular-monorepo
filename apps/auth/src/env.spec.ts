import { authEnvSchema } from './env';

const validEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_HOST: 'localhost',
  MONGO_URI: 'mongodb://localhost:27017/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000/api/auth',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'Admin123!',
  CORS_ORIGIN: 'http://localhost:4200',
};

describe('authEnvSchema AUDIT_RETENTION_DAYS', () => {
  it('defaults to 365 days', () => {
    expect(authEnvSchema.parse(validEnv).AUDIT_RETENTION_DAYS).toBe(365);
  });

  it('coerces a numeric string', () => {
    expect(
      authEnvSchema.parse({ ...validEnv, AUDIT_RETENTION_DAYS: '90' })
        .AUDIT_RETENTION_DAYS,
    ).toBe(90);
  });

  it.each(['0', '-5', '1.5', 'abc'])('rejects %p', (value) => {
    expect(
      authEnvSchema.safeParse({ ...validEnv, AUDIT_RETENTION_DAYS: value })
        .success,
    ).toBe(false);
  });
});
