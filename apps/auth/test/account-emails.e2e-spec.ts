import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { NotificationsPublisher } from '@repo/shared';
import { TEST_PASSWORD, truncateDatabase } from '@repo/testing-utils';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';

// Same trusted origin as auth.e2e-spec.ts (CORS_ORIGIN in .env.test).
const ORIGIN = 'http://localhost:4200';
const NEW_PASSWORD = 'Brand-new-pass-1!';

// A hand-rolled recorder: the e2e suites run as native ESM, where the `jest`
// object is not a global (and `@jest/globals` does not resolve from here).
const EVENTS = [
  'emitUserCreated',
  'emitUserInvited',
  'emitUserAccountActivated',
  'emitUserPasswordResetRequested',
  'emitUserPasswordChanged',
  'emitUserEmailVerificationRequested',
  'emitUserTwoFactorEnabled',
  'emitUserTwoFactorDisabled',
] as const;
type EventName = (typeof EVENTS)[number];

const emitted = Object.fromEntries(
  EVENTS.map((name) => [name, [] as Record<string, string>[]]),
) as Record<EventName, Record<string, string>[]>;

const publisher = Object.fromEntries(
  EVENTS.map((name) => [
    name,
    (payload: Record<string, string>) => {
      emitted[name].push(payload);
    },
  ]),
);

const resetEmitted = () => EVENTS.forEach((name) => (emitted[name].length = 0));

/** `?token=` of a link the publisher was asked to email. */
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

/** The better-auth hooks emit after the creating transaction commits. */
const eventually = async (assertion: () => void, timeoutMs = 3000) => {
  const start = Date.now();
  for (;;) {
    try {
      return assertion();
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
};

describe('account emails (E2E)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let adminCookie: string;
  let seededAdminEmitted: boolean;

  const http = () => supertest(app.getHttpServer());

  const uniqueEmail = (label: string) =>
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  const signInCookie = async (email: string, password: string) => {
    const res = await http()
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email, password });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) =>
      c.startsWith('better-auth.session_token='),
    );
    return session!.split(';')[0]!;
  };

  const adminCreateUser = (email: string) =>
    http()
      .post('/api/auth/admin/create-user')
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .send({ email, name: 'Invited User', role: 'user' });

  const requestReset = (email: string) =>
    http()
      .post('/api/auth/request-password-reset')
      .set('Origin', ORIGIN)
      .send({ email, redirectTo: `${ORIGIN}/reset-password` });

  const resetPassword = (token: string, newPassword = NEW_PASSWORD) =>
    http()
      .post('/api/auth/reset-password')
      .set('Origin', ORIGIN)
      .send({ token, newPassword });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsPublisher)
      .useValue(publisher)
      .compile();

    app = module.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = module.get(DatabaseService);

    // The seeder created the admin during init: it must not have been invited.
    seededAdminEmitted =
      emitted.emitUserInvited.length > 0 || emitted.emitUserCreated.length > 0;

    adminCookie = await signInCookie(
      process.env.ADMIN_EMAIL!,
      process.env.ADMIN_PASSWORD!,
    );
  });

  beforeEach(() => {
    resetEmitted();
  });

  afterAll(async () => {
    await truncateDatabase(db);
    await app.close();
  });

  it('does not invite or welcome the seeded administrator', () => {
    expect(seededAdminEmitted).toBe(false);
  });

  describe('admin creates an account', () => {
    it('emits exactly one invitation and no welcome event', async () => {
      const email = uniqueEmail('invited');

      const res = await adminCreateUser(email);
      expect(res.status).toBe(200);

      await eventually(() => expect(emitted.emitUserInvited).toHaveLength(1));
      const payload = emitted.emitUserInvited[0]!;
      expect(payload).toMatchObject({ email });
      expect(payload.invitationLink).toContain(
        `${ORIGIN}/reset-password?token=`,
      );
      expect(emitted.emitUserCreated).toHaveLength(0);
      expect(emitted.emitUserPasswordResetRequested).toHaveLength(0);
    });

    it('activates the account when the invited user sets a password', async () => {
      const email = uniqueEmail('activate');
      await adminCreateUser(email);
      await eventually(() =>
        expect(emitted.emitUserInvited.length).toBeGreaterThan(0),
      );
      const token = tokenOf(emitted.emitUserInvited[0]!.invitationLink!);

      const res = await resetPassword(token);
      expect(res.status).toBe(200);

      const user = await db.user.findUnique({ where: { email } });
      expect(user?.emailVerified).toBe(true);
      expect(emitted.emitUserAccountActivated).toContainEqual(
        expect.objectContaining({ email }),
      );
      expect(emitted.emitUserPasswordChanged).toHaveLength(0);

      await signInCookie(email, NEW_PASSWORD);
    });
  });

  describe('a password reset request', () => {
    it('re-sends the invitation for an account that never set a password', async () => {
      const email = uniqueEmail('reinvite');
      await adminCreateUser(email);
      await eventually(() => expect(emitted.emitUserInvited).toHaveLength(1));
      resetEmitted();

      const res = await requestReset(email);
      expect(res.status).toBe(200);

      await eventually(() => expect(emitted.emitUserInvited).toHaveLength(1));
      expect(emitted.emitUserPasswordResetRequested).toHaveLength(0);
    });

    it('sends a normal reset and a password-changed notice to a verified account', async () => {
      const email = uniqueEmail('verified');
      await http()
        .post('/api/auth/sign-up/email')
        .set('Origin', ORIGIN)
        .send({ email, password: TEST_PASSWORD, name: 'Verified User' });
      await db.user.updateMany({
        where: { email },
        data: { emailVerified: true },
      });
      resetEmitted();

      await requestReset(email);
      await eventually(() =>
        expect(emitted.emitUserPasswordResetRequested).toHaveLength(1),
      );
      expect(emitted.emitUserInvited).toHaveLength(0);

      const link = emitted.emitUserPasswordResetRequested[0]!.resetToken!;
      const res = await resetPassword(tokenOf(link));
      expect(res.status).toBe(200);

      expect(emitted.emitUserPasswordChanged).toContainEqual(
        expect.objectContaining({ email }),
      );
      expect(emitted.emitUserAccountActivated).toHaveLength(0);
    });

    it('sends nothing for an unknown email and answers like for a known one', async () => {
      const known = uniqueEmail('known');
      await adminCreateUser(known);
      await eventually(() =>
        expect(emitted.emitUserInvited.length).toBeGreaterThan(0),
      );
      resetEmitted();

      const knownRes = await requestReset(known);
      resetEmitted();
      const unknownRes = await requestReset(uniqueEmail('nobody'));

      expect(unknownRes.status).toBe(knownRes.status);
      expect(unknownRes.body).toEqual(knownRes.body);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(emitted.emitUserInvited).toHaveLength(0);
      expect(emitted.emitUserPasswordResetRequested).toHaveLength(0);
    });
  });

  describe('accounts created any other way', () => {
    it('sends no invitation on self sign-up (the welcome event still fires)', async () => {
      const email = uniqueEmail('selfsignup');

      await http()
        .post('/api/auth/sign-up/email')
        .set('Origin', ORIGIN)
        .send({ email, password: TEST_PASSWORD, name: 'Self Signup' });

      await eventually(() =>
        expect(emitted.emitUserCreated).toContainEqual(
          expect.objectContaining({ email }),
        ),
      );
      expect(emitted.emitUserInvited).toHaveLength(0);
    });
  });
});
