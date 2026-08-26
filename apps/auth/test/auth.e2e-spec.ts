import { ApplicationConfig } from '@nestjs/core';
import { INestApplication, VersioningType } from '@nestjs/common';
import { mapToExcludeRoute } from '@nestjs/core/middleware/utils.js';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { TEST_PASSWORD, truncateDatabase } from '@repo/testing-utils';
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
    app.setGlobalPrefix('api/auth');
    // Mirror production: exclude health from the global prefix so it's at /health/live
    // (better-auth intercepts all /api/auth/* so health must be outside that prefix)
    const appConfig = app.get(ApplicationConfig);
    const current = appConfig.getGlobalPrefixOptions();
    appConfig.setGlobalPrefixOptions({
      ...current,
      exclude: [
        ...(current.exclude ?? []),
        ...mapToExcludeRoute(['health', 'health/*path']),
      ],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = module.get(DatabaseService);
  });

  afterAll(async () => {
    await truncateDatabase(db);
    await app.close();
  });

  describe('GET /health/live', () => {
    it('returns 200', async () => {
      await supertest(app.getHttpServer()).get('/health/live').expect(200);
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
});
