import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import {
  AuditContextGuard,
  AuditInterceptor,
  MongoService,
  RolesGuard,
  SharedModule,
} from '@repo/shared';
import { truncateDatabase } from '@repo/testing-utils';
import supertest from 'supertest';
import { AuditEventsController } from '../src/audit/audit-events.controller';
import { CustomersModule } from '../src/customers/customers.module';
import { apiEnvSchema } from '../src/env';
import { FakeAuthGuard } from './fake-auth.guard';

const NIF = '123456789';
const CUSTOMERS = '/api/v1/customers';
const EVENTS = '/api/v1/audit-events';
const DAY_MS = 24 * 60 * 60 * 1000;

type Role = 'admin' | 'user';

describe('audit events (integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let mongo: MongoService;

  const http = () => supertest(app.getHttpServer());
  const as = (role: Role, req: supertest.Test) => req.set('x-test-role', role);

  /** Same registration order as src/app.module.ts: the audit guard is first. */
  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        SharedModule.register({
          validate: (c) => apiEnvSchema.parse(c),
          metrics: { appName: 'api-audit-integration' },
        }),
        CustomersModule,
      ],
      controllers: [AuditEventsController],
      providers: [
        { provide: APP_GUARD, useClass: AuditContextGuard },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    db = module.get(DatabaseService);
    mongo = module.get(MongoService);
  });

  beforeEach(async () => {
    await truncateDatabase(db);
  });

  afterAll(async () => {
    await truncateDatabase(db);
    await app.close();
  });

  const uniqueName = (label: string) =>
    `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  /** Writes are fire-and-forget, so poll briefly until the expected events exist. */
  const waitForEvents = async (
    filter: Record<string, unknown>,
    count: number,
    since: Date,
  ) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const { items, total } = await mongo.findAuditEvents(
        { from: since, ...filter },
        0,
        100,
      );
      if (total >= count || Date.now() > deadline) return items;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const createCustomer = (role: Role, body: Record<string, unknown>) =>
    as(role, http().post(CUSTOMERS)).send(body);

  it('records a customer create with the admin as actor, the new id as target and field names only', async () => {
    const since = new Date();
    const name = uniqueName('create');

    const res = await createCustomer('admin', {
      name,
      taxId: NIF,
      email: 'ana@example.com',
    }).expect(201);

    const events = await waitForEvents(
      { action: 'customer.create', targetId: res.body.id },
      1,
      since,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'success',
      actorId: 'test-admin',
      actorEmail: 'test-admin@example.com',
      targetType: 'customer',
      targetId: res.body.id,
    });
    expect(events[0]?.changedFields).toEqual(
      expect.arrayContaining(['name', 'taxId', 'email']),
    );
    expect(events[0]?.correlationId).toBeTruthy();
    expect(JSON.stringify(events)).not.toMatch(
      new RegExp(`${NIF}|ana@example.com|${name}`),
    );
  });

  it('expires each event after AUDIT_RETENTION_DAYS from apps/api/.env.test', async () => {
    const since = new Date();
    const res = await createCustomer('admin', {
      name: uniqueName('ttl'),
    }).expect(201);

    const [event] = await waitForEvents(
      { action: 'customer.create', targetId: res.body.id },
      1,
      since,
    );

    const days =
      (event!.expireAt.getTime() - event!.occurredAt.getTime()) / DAY_MS;
    expect(Math.round(days)).toBe(30);
  });

  it('records update and delete, listing the NIF as a changed field without its value', async () => {
    const since = new Date();
    const created = await createCustomer('admin', {
      name: uniqueName('ud'),
    }).expect(201);
    const id = created.body.id as string;

    await as('admin', http().patch(`${CUSTOMERS}/${id}`))
      .send({ taxId: NIF })
      .expect(200);
    await as('admin', http().delete(`${CUSTOMERS}/${id}`)).expect(204);

    const update = (
      await waitForEvents({ action: 'customer.update', targetId: id }, 1, since)
    )[0];
    expect(update).toMatchObject({
      outcome: 'success',
      changedFields: ['taxId'],
    });
    const del = (
      await waitForEvents({ action: 'customer.delete', targetId: id }, 1, since)
    )[0];
    expect(del).toMatchObject({
      outcome: 'success',
      actorId: 'test-admin',
      targetId: id,
    });
    expect(JSON.stringify([update, del])).not.toContain(NIF);
  });

  it('records a duplicate NIF as a 409 failure (once, by the interceptor)', async () => {
    const since = new Date();
    await createCustomer('admin', {
      name: uniqueName('dup1'),
      taxId: NIF,
    }).expect(201);

    await createCustomer('admin', {
      name: uniqueName('dup2'),
      taxId: NIF,
    }).expect(409);

    const failures = await waitForEvents(
      { action: 'customer.create', outcome: 'failure' },
      1,
      since,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      errorCode: '409',
      actorId: 'test-admin',
    });
    // A refused write changed nothing: no attempted field names are recorded.
    expect(failures[0]).not.toHaveProperty('changedFields');
  });

  it('records an unknown customer as a 404 failure with the id as target', async () => {
    const since = new Date();

    await as('admin', http().patch(`${CUSTOMERS}/does-not-exist`))
      .send({ name: 'x' })
      .expect(404);

    const [event] = await waitForEvents(
      { action: 'customer.update', outcome: 'failure' },
      1,
      since,
    );
    expect(event).toMatchObject({
      errorCode: '404',
      targetId: 'does-not-exist',
    });
  });

  it('records an unauthenticated write rejected by the guard as a 401 with no actor', async () => {
    const since = new Date();

    await http().post(CUSTOMERS).send({ name: 'nobody' }).expect(401);

    const events = await waitForEvents(
      { action: 'customer.create', outcome: 'failure' },
      1,
      since,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ errorCode: '401' });
    expect(events[0]?.actorId).toBeUndefined();
  });

  it('records a non-admin write rejected by the role guard as a 403 with the actor', async () => {
    const since = new Date();
    const created = await createCustomer('admin', {
      name: uniqueName('victim'),
    }).expect(201);
    const id = created.body.id as string;

    await createCustomer('user', { name: 'nope' }).expect(403);
    await as('user', http().patch(`${CUSTOMERS}/${id}`))
      .send({ name: 'nope' })
      .expect(403);
    await as('user', http().delete(`${CUSTOMERS}/${id}`)).expect(403);

    const failures = await waitForEvents(
      { outcome: 'failure', actorId: 'test-user' },
      3,
      since,
    );
    expect(failures.map((e) => e.action).sort()).toEqual([
      'customer.create',
      'customer.delete',
      'customer.update',
    ]);
    expect(failures.every((e) => e.errorCode === '403')).toBe(true);
    expect(failures.every((e) => e.changedFields === undefined)).toBe(true);
    expect(failures.find((e) => e.action === 'customer.delete')?.targetId).toBe(
      id,
    );
  });

  it('names the real admin when the rejected request came from an impersonation session', async () => {
    const since = new Date();

    await as(
      'user',
      http()
        .delete(`${CUSTOMERS}/some-id`)
        .set('x-test-impersonated-by', 'admin-0'),
    ).expect(403);

    const [event] = await waitForEvents(
      { action: 'customer.delete', outcome: 'failure' },
      1,
      since,
    );
    expect(event).toMatchObject({
      actorId: 'test-user',
      impersonatedById: 'admin-0',
    });
  });

  it('records nothing for reads: customer list/get and the audit log itself', async () => {
    const created = await createCustomer('admin', {
      name: uniqueName('reads'),
    }).expect(201);
    await waitForEvents({ targetId: created.body.id }, 1, new Date(0));
    const before = (await mongo.findAuditEvents({}, 0, 1)).total;

    await as('user', http().get(CUSTOMERS)).expect(200);
    await as('user', http().get(`${CUSTOMERS}/${created.body.id}`)).expect(200);
    await as('admin', http().get(EVENTS)).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect((await mongo.findAuditEvents({}, 0, 1)).total).toBe(before);
  });

  describe('GET /api/v1/audit-events', () => {
    const seed = async () => {
      const since = new Date();
      const a = await createCustomer('admin', {
        name: uniqueName('seedA'),
      }).expect(201);
      const b = await createCustomer('admin', {
        name: uniqueName('seedB'),
      }).expect(201);
      await as('admin', http().delete(`${CUSTOMERS}/${a.body.id}`)).expect(204);
      await createCustomer('user', { name: 'nope' }).expect(403);
      await waitForEvents({}, 4, since);
      return { since, a: a.body.id as string, b: b.body.id as string };
    };

    it('lists newest first in the paginated shape and never exposes expireAt', async () => {
      const { since } = await seed();

      const res = await as(
        'admin',
        http().get(EVENTS).query({ from: since.toISOString(), take: 2 }),
      ).expect(200);

      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2 });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(4);
      expect(res.body.items).toHaveLength(2);
      const times = res.body.items.map((e: { occurredAt: string }) =>
        Date.parse(e.occurredAt),
      );
      expect(times[0]).toBeGreaterThanOrEqual(times[1]);
      expect(res.body.items[0]).not.toHaveProperty('expireAt');
      expect(res.body.items[0]).toMatchObject({
        id: expect.any(String),
        occurredAt: expect.any(String),
      });
    });

    it('filters by actor, target, action, outcome and date range', async () => {
      const { since, a } = await seed();
      const q = (params: Record<string, string>) =>
        as(
          'admin',
          http()
            .get(EVENTS)
            .query({ from: since.toISOString(), ...params }),
        ).expect(200);

      const byTarget = await q({ targetId: a });
      expect(byTarget.body.items.length).toBeGreaterThanOrEqual(2);
      expect(
        byTarget.body.items.every(
          (e: { targetId: string }) => e.targetId === a,
        ),
      ).toBe(true);

      const byAction = await q({ action: 'customer.delete' });
      expect(
        byAction.body.items.every(
          (e: { action: string }) => e.action === 'customer.delete',
        ),
      ).toBe(true);

      const failures = await q({ outcome: 'failure', actorId: 'test-user' });
      expect(failures.body.items).toHaveLength(1);
      expect(failures.body.items[0]).toMatchObject({
        action: 'customer.create',
        errorCode: '403',
      });

      const future = new Date(Date.now() + DAY_MS).toISOString();
      const empty = await as(
        'admin',
        http().get(EVENTS).query({ from: future }),
      ).expect(200);
      expect(empty.body.items).toHaveLength(0);
      expect(empty.body.meta.total).toBe(0);
    });

    it('filters by the actor email, ignoring case and surrounding spaces', async () => {
      const { since } = await seed();

      const res = await as(
        'admin',
        http().get(EVENTS).query({
          from: since.toISOString(),
          actorEmail: '  Test-Admin@Example.com ',
        }),
      ).expect(200);

      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      expect(
        res.body.items.every(
          (e: { actorEmail: string }) =>
            e.actorEmail === 'test-admin@example.com',
        ),
      ).toBe(true);
    });

    it('rejects an unknown action, a bad date and take above 100 with 400', async () => {
      await as(
        'admin',
        http().get(EVENTS).query({ action: 'customer.read' }),
      ).expect(400);
      await as('admin', http().get(EVENTS).query({ from: 'yesterday' })).expect(
        400,
      );
      await as('admin', http().get(EVENTS).query({ take: 101 })).expect(400);
    });

    it('is admin only: 401 without a session and 403 for a non-admin', async () => {
      await http().get(EVENTS).expect(401);
      await as('user', http().get(EVENTS)).expect(403);
    });

    it('offers no way to change an event: every write method gets a 404', async () => {
      await as('admin', http().post(EVENTS)).send({}).expect(404);
      await as('admin', http().patch(`${EVENTS}/anything`))
        .send({})
        .expect(404);
      await as('admin', http().put(`${EVENTS}/anything`))
        .send({})
        .expect(404);
      await as('admin', http().delete(`${EVENTS}/anything`)).expect(404);
    });
  });
});
