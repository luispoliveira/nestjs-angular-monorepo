import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuditApi } from './audit.api';

const wireEvent = {
  id: 'e1',
  occurredAt: '2026-10-10T10:00:00.000Z',
  action: 'admin.user.ban',
  outcome: 'success',
  actorId: 'a1',
  actorEmail: 'admin@example.com',
  targetType: 'user',
  targetId: 'u1',
  changedFields: ['banned'],
  changes: { banned: true },
};

function setUp() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { api: TestBed.inject(AuditApi), http: TestBed.inject(HttpTestingController) };
}

describe('AuditApi', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lists through /api/v1/audit-events with every filter mapped to a query param', async () => {
    const { api, http } = setUp();

    const promise = api.list({
      skip: 20,
      take: 20,
      action: 'admin.user.ban',
      outcome: 'failure',
      actorId: 'a1',
      targetId: 'u1',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    const req = http.expectOne((r) => r.url === '/api/v1/audit-events');
    expect(req.request.method).toBe('GET');
    expect(Object.fromEntries(req.request.params.keys().map((k) => [k, req.request.params.get(k)]))).toEqual({
      skip: '20',
      take: '20',
      action: 'admin.user.ban',
      outcome: 'failure',
      actorId: 'a1',
      targetId: 'u1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
    });
    req.flush({ items: [wireEvent], meta: { page: 2, pageSize: 20, totalPages: 2, total: 21 } });

    const result = await promise;
    expect(result.items[0]?.occurredAt).toBeInstanceOf(Date);
    expect(result.items[0]).toMatchObject({ action: 'admin.user.ban', actorEmail: 'admin@example.com' });
    expect(result.meta.total).toBe(21);
  });

  it('omits empty and undefined filters', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20, actorId: '', targetId: undefined, outcome: undefined });
    const req = http.expectOne((r) => r.url === '/api/v1/audit-events');
    expect(req.request.params.keys().sort()).toEqual(['skip', 'take']);
    req.flush({ items: [], meta: { page: 1, pageSize: 20, totalPages: 0, total: 0 } });
    await promise;
  });

  it('rejects a response without meta.total instead of returning partial data', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20 });
    http
      .expectOne((r) => r.url === '/api/v1/audit-events')
      .flush({ items: [wireEvent], meta: { page: 1, pageSize: 20, totalPages: 1 } });

    await expect(promise).rejects.toThrow();
  });

  it('rejects an event with an unknown action (contract drift is loud)', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20 });
    http
      .expectOne((r) => r.url === '/api/v1/audit-events')
      .flush({
        items: [{ ...wireEvent, action: 'customer.read' }],
        meta: { page: 1, pageSize: 20, totalPages: 1, total: 1 },
      });

    await expect(promise).rejects.toThrow();
  });

  it('propagates the HTTP status of a failed request', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20 });
    http.expectOne((r) => r.url === '/api/v1/audit-events').flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    await expect(promise).rejects.toMatchObject({ status: 403 });
  });
});
