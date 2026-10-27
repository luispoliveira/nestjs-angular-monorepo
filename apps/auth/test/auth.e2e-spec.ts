import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { MongoService } from '@repo/shared';
import {
  TEST_PASSWORD,
  createUser,
  truncateDatabase,
} from '@repo/testing-utils';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';

describe('auth app (E2E)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication({ bodyParser: false });
    // Same prefix as src/main.ts (BootstrapUtil sets no exclusions for auth)
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = module.get(DatabaseService);
  });

  afterAll(async () => {
    await truncateDatabase(db);
    await app.close();
  });

  describe('GET /api/health/live', () => {
    it('returns 200', async () => {
      await supertest(app.getHttpServer()).get('/api/health/live').expect(200);
    });
  });

  describe('GET /api/auth/list-accounts (protected better-auth route)', () => {
    it('returns 401 without a session cookie', async () => {
      const response = await supertest(app.getHttpServer()).get(
        '/api/auth/list-accounts',
      );

      expect([401, 403]).toContain(response.status);
    });

    it('returns 200 with a valid injected session', async () => {
      // Use better-auth sign-up to get a proper password hash, then verify email manually
      const testEmail = `e2e-${Date.now()}@example.com`;
      await supertest(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({
          email: testEmail,
          password: TEST_PASSWORD,
          name: 'E2E Test User',
        });

      // Mark email as verified (bypass email verification for testing)
      await db.user.updateMany({
        where: { email: testEmail },
        data: { emailVerified: true },
      });

      // Sign in via the better-auth API to get a properly signed session cookie
      const signInRes = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: testEmail, password: TEST_PASSWORD });

      expect(signInRes.status).toBe(200);

      const cookies: string[] = Array.isArray(signInRes.headers['set-cookie'])
        ? signInRes.headers['set-cookie']
        : [signInRes.headers['set-cookie']].filter(Boolean);
      const sessionCookieHeader = cookies.find((c) =>
        c.startsWith('better-auth.session_token='),
      );
      const sessionToken = sessionCookieHeader?.match(
        /better-auth\.session_token=([^;]+)/,
      )?.[1];

      expect(sessionToken).toBeTruthy();

      await supertest(app.getHttpServer())
        .get('/api/auth/list-accounts')
        .set('Cookie', `better-auth.session_token=${sessionToken}`)
        .expect(200);
    });
  });

  describe('POST /api/auth/sign-in/email — origin validation', () => {
    // better-auth always implicitly trusts its own BETTER_AUTH_URL origin
    // (http://localhost:3001 here), so that alone would prove nothing about
    // the CORS_ORIGIN-derived trustedOrigins wiring. Use the second entry in
    // apps/auth/.env.test's CORS_ORIGIN — the Angular dev origin — instead,
    // since it is trusted *only* because of that configuration.
    const trustedOrigin = 'http://localhost:4200';
    const untrustedOrigin = 'http://evil.example.com';
    let testEmail: string;

    beforeAll(async () => {
      testEmail = `e2e-origin-${Date.now()}@example.com`;
      await supertest(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({
          email: testEmail,
          password: TEST_PASSWORD,
          name: 'Origin Test User',
        });
      await db.user.updateMany({
        where: { email: testEmail },
        data: { emailVerified: true },
      });
    });

    // better-auth only runs origin validation once a request carries a cookie
    // (any cookie, not just the session token) — a bare cookie is enough to
    // trigger it without needing a valid session.
    it('rejects a credentialed request from an untrusted origin', async () => {
      const response = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Cookie', 'probe=1')
        .set('Origin', untrustedOrigin)
        .send({ email: testEmail, password: TEST_PASSWORD });

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body).toLowerCase()).toContain('origin');
    });

    it('accepts a credentialed request from a trusted origin', async () => {
      const response = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Cookie', 'probe=1')
        .set('Origin', trustedOrigin)
        .send({ email: testEmail, password: TEST_PASSWORD });

      expect(response.status).toBe(200);
    });
  });

  describe('session cookie attributes', () => {
    async function signUpAndSignIn(
      server: Parameters<typeof supertest>[0],
      emailPrefix: string,
    ) {
      const testEmail = `${emailPrefix}-${Date.now()}@example.com`;
      await supertest(server).post('/api/auth/sign-up/email').send({
        email: testEmail,
        password: TEST_PASSWORD,
        name: 'Cookie Test User',
      });
      await db.user.updateMany({
        where: { email: testEmail },
        data: { emailVerified: true },
      });

      const signInRes = await supertest(server)
        .post('/api/auth/sign-in/email')
        .send({ email: testEmail, password: TEST_PASSWORD });

      const cookies: string[] = Array.isArray(signInRes.headers['set-cookie'])
        ? signInRes.headers['set-cookie']
        : [signInRes.headers['set-cookie']].filter(Boolean);

      return cookies.find((c) => c.includes('session_token='));
    }

    it('sets HttpOnly and SameSite=Lax, and omits Secure, on an http BETTER_AUTH_URL', async () => {
      // apps/auth/.env.test sets BETTER_AUTH_URL="http://localhost:3001/api/auth"
      const sessionCookie = await signUpAndSignIn(
        app.getHttpServer(),
        'e2e-cookie-http',
      );

      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/SameSite=Lax/i);
      expect(sessionCookie).not.toMatch(/;\s*Secure/i);
      expect(sessionCookie).not.toMatch(/^__Secure-/);
    });

    // The Secure attribute / __Secure- prefix for an https BETTER_AUTH_URL is
    // covered by test/cookie-secure-prefix.e2e-spec.ts, not here: NestJS's
    // ConfigModule reads and validates the env synchronously the first time
    // app.module.ts is imported (at this file's top-level `import { AppModule }`),
    // and that resolved config is baked into the AppModule class metadata —
    // a second Test.createTestingModule({ imports: [AppModule] }) in the same
    // process reuses it regardless of later process.env mutations, so an
    // https override cannot be exercised by booting a second app here.
  });

  describe('audit events', () => {
    // The after hook awaits the audit write, so an event exists by the time
    // the response returns — no polling needed.
    const TRUSTED_ORIGIN = 'http://localhost:4200';
    let mongo: MongoService;
    let startedAt: Date;

    beforeAll(() => {
      mongo = app.get(MongoService, { strict: false });
      startedAt = new Date();
    });

    const eventsFor = async (filter: Record<string, unknown> = {}) =>
      (await mongo.findAuditEvents({ from: startedAt, ...filter }, 0, 100))
        .items;

    const signIn = async (email: string, password = TEST_PASSWORD) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password });
      const cookies: string[] = Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie']
        : [res.headers['set-cookie']].filter(Boolean);
      const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
      return { status: res.status, cookie };
    };

    const makeUser = async (label: string, role: 'user' | 'admin' = 'user') => {
      const email = `audit-${label}-${Date.now()}@example.com`;
      const created = await createUser(db, {
        email,
        role,
        emailVerified: true,
      });
      return { id: created.id, email };
    };

    it('records a successful sign-in with the user as actor and a correlation id', async () => {
      const user = await makeUser('signin');

      const { status } = await signIn(user.email);

      expect(status).toBe(200);
      const events = await eventsFor({
        actorId: user.id,
        action: 'auth.sign-in',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        outcome: 'success',
        actorEmail: user.email,
      });
      expect(events[0]?.correlationId).toBeTruthy();
    });

    it('records a wrong password as a failure with the attempted email, never the password', async () => {
      const user = await makeUser('wrongpw');

      const { status } = await signIn(user.email, 'DefinitelyWrong1!');

      expect(status).toBe(401);
      const failures = (
        await eventsFor({ action: 'auth.sign-in', outcome: 'failure' })
      ).filter((e) => e.attemptedEmail === user.email);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        errorCode: '401:INVALID_EMAIL_OR_PASSWORD',
      });
      expect(failures[0]?.actorId).toBeUndefined();
      expect(JSON.stringify(failures)).not.toContain('DefinitelyWrong1!');
    });

    it('records sign-out with the signed-out user as actor (session looked up before it is cleared)', async () => {
      const user = await makeUser('signout');
      const { cookie } = await signIn(user.email);

      await supertest(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .set('Origin', TRUSTED_ORIGIN)
        .send({})
        .expect(200);

      const events = await eventsFor({
        actorId: user.id,
        action: 'auth.sign-out',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        outcome: 'success',
        actorEmail: user.email,
      });
    });

    it('records admin ban and set-role with the admin as actor, the user as target and safe changes only', async () => {
      const admin = await makeUser('admin', 'admin');
      const target = await makeUser('target');
      const { cookie } = await signIn(admin.email);
      const call = (path: string, body: Record<string, unknown>) =>
        supertest(app.getHttpServer())
          .post(`/api/auth/admin/${path}`)
          .set('Cookie', cookie)
          .set('Origin', TRUSTED_ORIGIN)
          .send(body);

      await call('ban-user', { userId: target.id, banReason: 'spam' }).expect(
        200,
      );
      await call('set-role', { userId: target.id, role: 'admin' }).expect(200);

      const ban = (
        await eventsFor({ actorId: admin.id, action: 'admin.user.ban' })
      )[0];
      expect(ban).toMatchObject({
        outcome: 'success',
        actorEmail: admin.email,
        targetType: 'user',
        targetId: target.id,
        changes: { banned: true, banReason: 'spam' },
      });
      const setRole = (
        await eventsFor({ actorId: admin.id, action: 'admin.user.set-role' })
      )[0];
      expect(setRole).toMatchObject({
        targetId: target.id,
        changedFields: ['role'],
        changes: { role: 'admin' },
      });
    });

    it('records a rejected admin action as a failure with the 403 and the non-admin actor', async () => {
      const nonAdmin = await makeUser('nonadmin');
      const target = await makeUser('victim');
      const { cookie } = await signIn(nonAdmin.email);

      const res = await supertest(app.getHttpServer())
        .post('/api/auth/admin/ban-user')
        .set('Cookie', cookie)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ userId: target.id, banReason: 'nope' });

      expect(res.status).toBe(403);
      const events = await eventsFor({
        actorId: nonAdmin.id,
        action: 'admin.user.ban',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        outcome: 'failure',
        targetId: target.id,
      });
      expect(events[0]?.errorCode).toMatch(/^403/);
      // The ban was refused, so the event must not claim anything changed.
      expect(events[0]).not.toHaveProperty('changedFields');
      expect(events[0]).not.toHaveProperty('changes');
    });

    it('records nothing for read endpoints such as get-session', async () => {
      const user = await makeUser('reads');
      const { cookie } = await signIn(user.email);
      const before = (await mongo.findAuditEvents({ actorId: user.id }, 0, 100))
        .total;

      await supertest(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);
      await supertest(app.getHttpServer())
        .get('/api/auth/list-sessions')
        .set('Cookie', cookie)
        .expect(200);

      expect(
        (await mongo.findAuditEvents({ actorId: user.id }, 0, 100)).total,
      ).toBe(before);
    });

    it('truncates a hostile attempted email so an anonymous request cannot bloat the log', async () => {
      const marker = `bloat${Date.now()}`;
      const hostile = `${marker}${'a'.repeat(200000)}@example.com`;

      const res = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: hostile, password: 'x' });

      expect(res.status).toBe(401);
      const stored = (
        await eventsFor({ action: 'auth.sign-in', outcome: 'failure' })
      ).filter((e) => e.attemptedEmail?.startsWith(marker));
      expect(stored).toHaveLength(1);
      expect(stored[0]?.attemptedEmail).toHaveLength(254);
    });

    it('records the address the trusted proxy appended, not a forged first X-Forwarded-For hop', async () => {
      const user = await makeUser('xff');

      await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('X-Forwarded-For', '6.6.6.6, 198.51.100.9')
        .send({ email: user.email, password: 'DefinitelyWrong1!' })
        .expect(401);

      const failures = (
        await eventsFor({ action: 'auth.sign-in', outcome: 'failure' })
      ).filter((e) => e.attemptedEmail === user.email);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.ip).toBe('198.51.100.9');
    });

    it('names the owner of the revoked session as the target of admin revoke-user-session', async () => {
      const admin = await makeUser('revoker', 'admin');
      const target = await makeUser('revoked');
      const adminSession = await signIn(admin.email);
      // The request only carries a session token, never the user id.
      const targetSignIn = await supertest(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: target.email, password: TEST_PASSWORD });
      const sessionToken = targetSignIn.body.token as string;

      await supertest(app.getHttpServer())
        .post('/api/auth/admin/revoke-user-session')
        .set('Cookie', adminSession.cookie)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ sessionToken })
        .expect(200);

      const events = await eventsFor({
        actorId: admin.id,
        action: 'admin.user.revoke-session',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        outcome: 'success',
        targetType: 'user',
        targetId: target.id,
      });
      expect(JSON.stringify(events)).not.toContain(sessionToken);
    });
  });
});
