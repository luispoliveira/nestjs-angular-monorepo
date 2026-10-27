import { workerEnvSchema } from './env';

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_HOST: 'localhost',
  MONGO_URI: 'mongodb://localhost:27017/db',
  CORS_ORIGIN: 'http://localhost:4200',
  FROM_EMAIL: 'no-reply@example.com',
  VAPID_SUBJECT: 'mailto:ops@example.com',
  VAPID_PUBLIC_KEY: 'BPublicKey',
  VAPID_PRIVATE_KEY: 'private-key',
};

const failedPaths = (env: Record<string, unknown>) => {
  const result = workerEnvSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('workerEnvSchema mail provider', () => {
  it('defaults MAIL_PROVIDER to brevo', () => {
    const env = workerEnvSchema.parse({ ...baseEnv, BREVO_API_KEY: 'b' });
    expect(env.MAIL_PROVIDER).toBe('brevo');
  });

  it('accepts resend with only RESEND_API_KEY set', () => {
    const env = workerEnvSchema.parse({
      ...baseEnv,
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_key',
    });
    expect(env.MAIL_PROVIDER).toBe('resend');
  });

  it('rejects an unknown MAIL_PROVIDER, naming it', () => {
    expect(failedPaths({ ...baseEnv, MAIL_PROVIDER: 'sendgrid' })).toContain(
      'MAIL_PROVIDER',
    );
  });

  it('requires RESEND_API_KEY when resend is active', () => {
    expect(failedPaths({ ...baseEnv, MAIL_PROVIDER: 'resend' })).toEqual([
      'RESEND_API_KEY',
    ]);
  });

  it('requires BREVO_API_KEY when brevo is active (also by default)', () => {
    expect(failedPaths(baseEnv)).toEqual(['BREVO_API_KEY']);
    expect(failedPaths({ ...baseEnv, MAIL_PROVIDER: 'brevo' })).toEqual([
      'BREVO_API_KEY',
    ]);
  });

  it('does not require the inactive provider key', () => {
    expect(
      failedPaths({ ...baseEnv, MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }),
    ).toEqual([]);
    expect(failedPaths({ ...baseEnv, BREVO_API_KEY: 'b' })).toEqual([]);
  });

  it('still requires FROM_EMAIL for either provider', () => {
    const withoutFrom: Record<string, string> = { ...baseEnv };
    delete withoutFrom.FROM_EMAIL;
    expect(failedPaths({ ...withoutFrom, BREVO_API_KEY: 'b' })).toContain(
      'FROM_EMAIL',
    );
    expect(
      failedPaths({
        ...withoutFrom,
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'k',
      }),
    ).toContain('FROM_EMAIL');
  });
});

describe('workerEnvSchema VAPID keys', () => {
  const withBrevo = { ...baseEnv, BREVO_API_KEY: 'b' };

  it.each(['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'])(
    'requires %s',
    (key) => {
      const env: Record<string, unknown> = { ...withBrevo };
      delete env[key];
      expect(failedPaths(env)).toEqual([key]);
    },
  );

  it.each(['mailto:ops@example.com', 'https://app.example.com/contact'])(
    'accepts the VAPID_SUBJECT %p',
    (subject) => {
      expect(failedPaths({ ...withBrevo, VAPID_SUBJECT: subject })).toEqual([]);
    },
  );

  it.each(['ops@example.com', 'http://app.example.com', 'not a subject'])(
    'rejects the VAPID_SUBJECT %p (push services need a mailto: or https: contact)',
    (subject) => {
      expect(failedPaths({ ...withBrevo, VAPID_SUBJECT: subject })).toEqual([
        'VAPID_SUBJECT',
      ]);
    },
  );
});
