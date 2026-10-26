import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { QUEUES, RolesGuard, SharedModule } from '@repo/shared';
import { truncateDatabase } from '@repo/testing-utils';
import { Queue } from 'bullmq';
import supertest from 'supertest';

import { apiEnvSchema } from '../src/env';
import { PushModule } from '../src/push/push.module';
import { FakeAuthGuard } from './fake-auth.guard';

const BASE = '/api/v1/push';
const sub = (n: number) => ({
  endpoint: `https://push.example.com/send/device-${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

describe('push (integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let queue: Queue;

  const http = () => supertest(app.getHttpServer());
  const asUser = (req: supertest.Test) => req.set('x-test-role', 'user');
  const asAdmin = (req: supertest.Test) => req.set('x-test-role', 'admin');

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        SharedModule.register({
          validate: (c) => apiEnvSchema.parse(c),
          metrics: { appName: 'api-integration' },
        }),
        PushModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = module.get(DatabaseService);
    queue = module.get<Queue>(getQueueToken(QUEUES.PUSH));
  });

  beforeEach(async () => {
    await truncateDatabase(db);
    await queue.obliterate({ force: true });
    // FakeAuthGuard ids (`test-<role>`) must be real rows for the FK.
    await db.user.createMany({
      data: ['user', 'admin'].map((role) => ({
        id: `test-${role}`,
        name: role,
        email: `test-${role}@example.com`,
      })),
    });
  });

  afterAll(async () => {
    await truncateDatabase(db);
    await queue.obliterate({ force: true });
    await app.close();
  });

  const rows = (where: object = {}) =>
    db.pushSubscription.findMany({ where, orderBy: { createdAt: 'asc' } });

  describe('authentication', () => {
    it('refuses every endpoint without a session', async () => {
      await http().get(`${BASE}/public-key`).expect(401);
      await http().post(`${BASE}/subscriptions`).send(sub(1)).expect(401);
      await http()
        .delete(`${BASE}/subscriptions`)
        .send({ endpoint: sub(1).endpoint })
        .expect(401);
      await http().post(`${BASE}/test`).expect(401);
    });

    it('needs no role beyond being signed in', async () => {
      await asUser(http().get(`${BASE}/public-key`)).expect(200);
      await asAdmin(http().get(`${BASE}/public-key`)).expect(200);
    });
  });

  describe('GET /push/public-key', () => {
    it('returns the public key and nothing else', async () => {
      const { body } = await asUser(http().get(`${BASE}/public-key`)).expect(
        200,
      );
      expect(body).toEqual({ publicKey: process.env.VAPID_PUBLIC_KEY });
      expect(JSON.stringify(body)).not.toMatch(/private/i);
    });
  });

  describe('POST /push/subscriptions', () => {
    it('stores the subscription for the caller, one row per browser', async () => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .set('user-agent', 'Firefox/1')
        .send(sub(1))
        .expect(204);
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(2))
        .expect(204);

      const stored = await rows();
      expect(stored).toHaveLength(2);
      expect(stored.every((row) => row.userId === 'test-user')).toBe(true);
      expect(stored[0]).toMatchObject({
        endpoint: sub(1).endpoint,
        p256dh: 'p256dh-1',
        auth: 'auth-1',
        userAgent: 'Firefox/1',
        deletedAt: null,
      });
    });

    it('is idempotent for the same browser', async () => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      expect(await rows()).toHaveLength(1);
    });

    it('hands the browser to the latest subscriber', async () => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      await asAdmin(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);

      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.userId).toBe('test-admin');
    });

    it('revives a subscription that had been removed', async () => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      await asUser(http().delete(`${BASE}/subscriptions`))
        .send({ endpoint: sub(1).endpoint })
        .expect(204);
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);

      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.deletedAt).toBeNull();
    });

    it.each([
      { ...sub(1), endpoint: 'http://push.example.com/x' },
      { ...sub(1), endpoint: 'nope' },
      { endpoint: sub(1).endpoint },
      { ...sub(1), keys: { p256dh: 'only' } },
    ])('rejects the invalid body %j with 400', async (body) => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(body)
        .expect(400);
      expect(await rows()).toHaveLength(0);
    });
  });

  describe('DELETE /push/subscriptions', () => {
    it('removes the caller’s own subscription', async () => {
      await asUser(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      await asUser(http().delete(`${BASE}/subscriptions`))
        .send({ endpoint: sub(1).endpoint })
        .expect(204);

      const [row] = await rows();
      expect(row!.deletedAt).not.toBeNull();
    });

    it('succeeds without touching another user’s subscription', async () => {
      await asAdmin(http().post(`${BASE}/subscriptions`))
        .send(sub(1))
        .expect(204);
      await asUser(http().delete(`${BASE}/subscriptions`))
        .send({ endpoint: sub(1).endpoint })
        .expect(204);

      const [row] = await rows();
      expect(row).toMatchObject({ userId: 'test-admin', deletedAt: null });
    });

    it('succeeds for an endpoint that does not exist', async () => {
      await asUser(http().delete(`${BASE}/subscriptions`))
        .send({ endpoint: sub(9).endpoint })
        .expect(204);
    });
  });

  describe('POST /push/test', () => {
    it('queues one push addressed only to the caller', async () => {
      await asUser(http().post(`${BASE}/test`)).expect(202);

      const jobs = await queue.getJobs(['waiting']);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe('job:send_push_notification');
      expect(jobs[0]!.data).toMatchObject({
        userIds: ['test-user'],
        url: '/account',
        tag: 'test',
      });
    });

    it('succeeds for a user with no subscription (nothing is shown anywhere)', async () => {
      await asUser(http().post(`${BASE}/test`)).expect(202);
      expect(await rows()).toHaveLength(0);
    });
  });
});
