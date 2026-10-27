import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { MongoService, RolesGuard, SharedModule } from '@repo/shared';
import { truncateDatabase } from '@repo/testing-utils';
import supertest from 'supertest';
import { CustomersModule } from '../src/customers/customers.module';
import { apiEnvSchema } from '../src/env';
import { FakeAuthGuard } from './fake-auth.guard';

const NIF = '123456789';
const OTHER_NIF = '999999990';
const BASE = '/api/v1/customers';

describe('customers (integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let mongo: MongoService;

  const http = () => supertest(app.getHttpServer());
  const asAdmin = (req: supertest.Test) => req.set('x-test-role', 'admin');
  const asUser = (req: supertest.Test) => req.set('x-test-role', 'user');

  const createAsAdmin = (body: Record<string, unknown>) =>
    asAdmin(http().post(BASE)).send(body);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        SharedModule.register({
          validate: (c) => apiEnvSchema.parse(c),
          metrics: { appName: 'api-integration' },
        }),
        CustomersModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    // Same prefix/versioning as src/main.ts (BootstrapUtil)
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

  describe('authorization', () => {
    it('rejects an unauthenticated request with 401', async () => {
      await http().get(BASE).expect(401);
      await http().post(BASE).send({ name: 'Ana' }).expect(401);
    });

    it('lets a non-admin read', async () => {
      const { body } = await createAsAdmin({ name: 'Ana' }).expect(201);

      await asUser(http().get(BASE)).expect(200);
      await asUser(http().get(`${BASE}/${body.id}`)).expect(200);
    });

    it('rejects non-admin writes with 403 and changes nothing', async () => {
      const { body } = await createAsAdmin({ name: 'Ana' }).expect(201);

      await asUser(http().post(BASE)).send({ name: 'Bob' }).expect(403);
      await asUser(http().patch(`${BASE}/${body.id}`))
        .send({ name: 'Changed' })
        .expect(403);
      await asUser(http().delete(`${BASE}/${body.id}`)).expect(403);

      expect(await db.customer.count()).toBe(1);
      const row = await db.customer.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.name).toBe('Ana');
      expect(row.deletedAt).toBeNull();
    });
  });

  describe('CRUD and validation', () => {
    it('round-trips the normalized NIF and stores no plaintext', async () => {
      const created = await createAsAdmin({
        name: 'Ana Silva',
        email: 'ana@example.com',
        taxId: 'PT 123 456 789',
      }).expect(201);

      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Ana Silva',
        email: 'ana@example.com',
        taxId: NIF,
        notes: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const fetched = await asUser(
        http().get(`${BASE}/${created.body.id}`),
      ).expect(200);
      expect(fetched.body.taxId).toBe(NIF);

      const row = await db.customer.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(JSON.stringify(row)).not.toContain(NIF);
      expect(row.taxIdEncrypted).toBeTruthy();
      expect(row.taxIdHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('updates only the sent fields and clears taxId with null', async () => {
      const { body } = await createAsAdmin({
        name: 'Ana',
        email: 'ana@example.com',
        taxId: NIF,
      }).expect(201);

      const renamed = await asAdmin(http().patch(`${BASE}/${body.id}`))
        .send({ name: 'Ana Maria' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        name: 'Ana Maria',
        email: 'ana@example.com',
        taxId: NIF,
      });

      const cleared = await asAdmin(http().patch(`${BASE}/${body.id}`))
        .send({ taxId: null })
        .expect(200);
      expect(cleared.body.taxId).toBeNull();
    });

    it('returns 400 for an invalid body and creates nothing', async () => {
      await createAsAdmin({}).expect(400);
      await createAsAdmin({ name: 'Ana', taxId: '123456788' }).expect(400);

      expect(await db.customer.count()).toBe(0);
    });

    it('returns 404 for an unknown id', async () => {
      await asUser(http().get(`${BASE}/does-not-exist`)).expect(404);
      await asAdmin(http().patch(`${BASE}/does-not-exist`))
        .send({ name: 'x' })
        .expect(404);
      await asAdmin(http().delete(`${BASE}/does-not-exist`)).expect(404);
    });
  });

  describe('soft delete', () => {
    it('hides a deleted customer from every operation', async () => {
      const { body } = await createAsAdmin({ name: 'Ana' }).expect(201);

      await asAdmin(http().delete(`${BASE}/${body.id}`)).expect(204);

      const row = await db.customer.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.deletedAt).toBeInstanceOf(Date);

      await asUser(http().get(`${BASE}/${body.id}`)).expect(404);
      await asAdmin(http().patch(`${BASE}/${body.id}`))
        .send({ name: 'x' })
        .expect(404);
      await asAdmin(http().delete(`${BASE}/${body.id}`)).expect(404);

      const list = await asUser(http().get(BASE)).expect(200);
      expect(list.body.items).toHaveLength(0);
      expect(list.body.meta.total).toBe(0);
    });
  });

  describe('NIF uniqueness among active customers', () => {
    it('rejects a duplicate NIF written in another notation with 409', async () => {
      await createAsAdmin({ name: 'Ana', taxId: NIF }).expect(201);

      await createAsAdmin({ name: 'Bob', taxId: 'pt 123456789' }).expect(409);

      expect(await db.customer.count()).toBe(1);
    });

    it('rejects updating to another active customer NIF with 409', async () => {
      await createAsAdmin({ name: 'Ana', taxId: NIF }).expect(201);
      const bob = await createAsAdmin({ name: 'Bob', taxId: OTHER_NIF }).expect(
        201,
      );

      await asAdmin(http().patch(`${BASE}/${bob.body.id}`))
        .send({ taxId: NIF })
        .expect(409);

      const fetched = await asUser(http().get(`${BASE}/${bob.body.id}`));
      expect(fetched.body.taxId).toBe(OTHER_NIF);
    });

    it('lets exactly one of two concurrent creates win', async () => {
      const statuses = (
        await Promise.all([
          createAsAdmin({ name: 'Ana', taxId: NIF }),
          createAsAdmin({ name: 'Bob', taxId: NIF }),
        ])
      )
        .map((r) => r.status)
        .sort();

      expect(statuses).toEqual([201, 409]);
      expect(await db.customer.count()).toBe(1);
    });

    it('frees the NIF of a deleted customer', async () => {
      const { body } = await createAsAdmin({ name: 'Ana', taxId: NIF }).expect(
        201,
      );
      await asAdmin(http().delete(`${BASE}/${body.id}`)).expect(204);

      await createAsAdmin({ name: 'Bob', taxId: NIF }).expect(201);
    });
  });

  describe('listing and search', () => {
    beforeEach(async () => {
      await createAsAdmin({
        name: 'Ana Silva',
        email: 'ana@example.com',
        taxId: NIF,
      }).expect(201);
      await createAsAdmin({
        name: 'Bruno Costa',
        email: 'bruno.SILVA@example.com',
      }).expect(201);
      await createAsAdmin({ name: 'Carla Dias', taxId: OTHER_NIF }).expect(201);
    });

    const names = (res: supertest.Response) =>
      (res.body.items as { name: string }[]).map((c) => c.name).sort();

    it('returns newest first by default with meta', async () => {
      const res = await asUser(http().get(BASE)).expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Carla Dias',
        'Bruno Costa',
        'Ana Silva',
      ]);
      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalPages: 1,
        total: 3,
      });
    });

    it('matches name or email partially, case-insensitively', async () => {
      const res = await asUser(http().get(BASE).query({ search: 'silva' }));

      expect(names(res)).toEqual(['Ana Silva', 'Bruno Costa']);
    });

    it('matches a full NIF in any notation', async () => {
      const res = await asUser(
        http().get(BASE).query({ search: 'PT 999 999 990' }),
      );

      expect(names(res)).toEqual(['Carla Dias']);
    });

    it('does not match by a partial NIF', async () => {
      const res = await asUser(http().get(BASE).query({ search: '99999' }));

      expect(res.body.items).toHaveLength(0);
    });

    it('paginates and sorts from the allow-list', async () => {
      const res = await asUser(
        http().get(BASE).query({ sortBy: 'name', sortOrder: 'asc', take: 2 }),
      ).expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Ana Silva',
        'Bruno Costa',
      ]);
      expect(res.body.meta.totalPages).toBe(2);
    });

    it('rejects sortBy outside the allow-list and take above 100 with 400', async () => {
      await asUser(http().get(BASE).query({ sortBy: 'taxId' })).expect(400);
      await asUser(http().get(BASE).query({ take: 101 })).expect(400);
    });
  });

  describe('log redaction', () => {
    it('stores taxId redacted in the request and response logs', async () => {
      const createLog = jest.spyOn(mongo, 'createLog');
      const updateLog = jest.spyOn(mongo, 'updateLog');

      await createAsAdmin({ name: 'Ana', taxId: NIF }).expect(201);

      const requestLog = createLog.mock.calls.at(-1)?.[0];
      expect(requestLog?.requestBody).toMatchObject({
        name: 'Ana',
        taxId: '[SANITIZED]',
      });
      const responseLog = updateLog.mock.calls.at(-1)?.[1];
      expect(responseLog?.responseBody).toMatchObject({
        taxId: '[SANITIZED]',
      });
      expect(JSON.stringify(createLog.mock.calls)).not.toContain(NIF);
      expect(JSON.stringify(updateLog.mock.calls)).not.toContain(NIF);

      createLog.mockRestore();
      updateLog.mockRestore();
    });

    it('stores a NIF search with the search value redacted in the url', async () => {
      await createAsAdmin({ name: 'Ana', taxId: NIF }).expect(201);
      const createLog = jest.spyOn(mongo, 'createLog');

      await asUser(http().get(BASE).query({ search: NIF })).expect(200);

      const requestLog = createLog.mock.calls.at(-1)?.[0];
      expect(requestLog?.url).toContain('search=[SANITIZED]');
      expect(JSON.stringify(createLog.mock.calls)).not.toContain(NIF);

      createLog.mockRestore();
    });
  });
});
