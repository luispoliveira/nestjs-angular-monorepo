import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CustomersApi } from './customers.api';

const wireCustomer = {
  id: 'c1',
  name: 'Ana Silva',
  email: 'ana@example.com',
  taxId: '123456789',
  notes: null,
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { api: TestBed.inject(CustomersApi), http: TestBed.inject(HttpTestingController) };
}

describe('CustomersApi', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lists through /api/v1/customers with the query params and returns parsed data', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 20, take: 20, search: 'silva' });
    const req = http.expectOne((r) => r.url === '/api/v1/customers');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('skip')).toBe('20');
    expect(req.request.params.get('take')).toBe('20');
    expect(req.request.params.get('search')).toBe('silva');
    req.flush({ items: [wireCustomer], meta: { page: 2, pageSize: 20, totalPages: 2, total: 21 } });

    const result = await promise;
    expect(result.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(result.meta.total).toBe(21);
  });

  it('omits empty query params', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20, search: '' });
    const req = http.expectOne((r) => r.url === '/api/v1/customers');
    expect(req.request.params.has('search')).toBe(false);
    req.flush({ items: [], meta: { page: 1, pageSize: 20, totalPages: 0, total: 0 } });
    await promise;
  });

  it('rejects a malformed list response instead of returning partial data', async () => {
    const { api, http } = setUp();

    const promise = api.list({ skip: 0, take: 20 });
    http
      .expectOne((r) => r.url === '/api/v1/customers')
      .flush({ items: [wireCustomer], meta: { page: 1, pageSize: 20, totalPages: 1 } });

    await expect(promise).rejects.toThrow();
  });

  it('creates with POST and parses the response', async () => {
    const { api, http } = setUp();

    const promise = api.create({ name: 'Ana Silva', taxId: '123456789' });
    const req = http.expectOne('/api/v1/customers');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Ana Silva', taxId: '123456789' });
    req.flush(wireCustomer);

    expect((await promise).id).toBe('c1');
  });

  it('updates with PATCH on the customer path', async () => {
    const { api, http } = setUp();

    const promise = api.update('c1', { taxId: null });
    const req = http.expectOne('/api/v1/customers/c1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ taxId: null });
    req.flush({ ...wireCustomer, taxId: null });

    expect((await promise).taxId).toBeNull();
  });

  it('removes with DELETE on the customer path', async () => {
    const { api, http } = setUp();

    const promise = api.remove('c1');
    const req = http.expectOne('/api/v1/customers/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(promise).resolves.toBeUndefined();
  });

  it('propagates the HTTP status of a failed request', async () => {
    const { api, http } = setUp();

    const promise = api.create({ name: 'Ana', taxId: '123456789' });
    http.expectOne('/api/v1/customers').flush({ message: 'NIF already in use' }, { status: 409, statusText: 'Conflict' });

    await expect(promise).rejects.toMatchObject({ status: 409 });
  });
});
