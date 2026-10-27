import { CallHandler, ConflictException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Audit } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

class Dummy {
  @Audit('customer.update', { targetType: 'customer', fields: ['name', 'taxId'] })
  update() {}

  @Audit('customer.create', { targetType: 'customer' })
  create() {}

  @Audit('customer.delete', { targetType: 'customer' })
  remove() {}

  read() {}
}

const makeRequest = (overrides: Record<string, unknown> = {}) => ({
  params: {},
  body: undefined,
  user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
  ip: '10.0.0.1',
  headers: { 'user-agent': 'jest' },
  ...overrides,
});

const contextFor = (handler: () => void, request: Record<string, unknown>) =>
  ({
    getHandler: () => handler,
    getClass: () => Dummy,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('AuditInterceptor', () => {
  let audit: { record: jest.Mock };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(new Reflector(), audit as unknown as AuditService);
  });

  const run = (handler: () => void, request: Record<string, unknown>, next: CallHandler) =>
    lastValueFrom(interceptor.intercept(contextFor(handler, request), next));

  it('passes through without recording when the handler is not audited', async () => {
    const result = await run(Dummy.prototype.read, makeRequest(), { handle: () => of('ok') });

    expect(result).toBe('ok');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records a success with actor, param target, changed fields and client info', async () => {
    const request = makeRequest({ params: { id: 'c1' }, body: { name: 'Ana', taxId: '123456789' } });

    const result = await run(Dummy.prototype.update, request, { handle: () => of({ id: 'c1', name: 'Ana' }) });

    expect(result).toEqual({ id: 'c1', name: 'Ana' });
    expect(audit.record).toHaveBeenCalledWith({
      action: 'customer.update',
      outcome: 'success',
      actorId: 'admin-1',
      actorEmail: 'admin@example.com',
      targetType: 'customer',
      targetId: 'c1',
      changedFields: ['name', 'taxId'],
      ip: '10.0.0.1',
      userAgent: 'jest',
    });
  });

  it('takes the target from the response when the route has no id param', async () => {
    await run(Dummy.prototype.create, makeRequest({ body: { name: 'Ana' } }), { handle: () => of({ id: 'new-1' }) });

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'new-1', changedFields: ['name'] }));
  });

  it('lists only declared fields, ignoring unknown body keys', async () => {
    const request = makeRequest({ params: { id: 'c1' }, body: { name: 'Ana', taxIdHash: 'evil', deletedAt: 'x' } });

    await run(Dummy.prototype.update, request, { handle: () => of({ id: 'c1' }) });

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ changedFields: ['name'] }));
  });

  it('lists every body key when the decorator declares no fields', async () => {
    await run(Dummy.prototype.create, makeRequest({ body: { a: 1, b: 2 } }), { handle: () => of({ id: 'x' }) });

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ changedFields: ['a', 'b'] }));
  });

  it('records no changed fields for a request without a body', async () => {
    await run(Dummy.prototype.remove, makeRequest({ params: { id: 'c1' } }), { handle: () => of(undefined) });

    const event = audit.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(event).not.toHaveProperty('changedFields');
    expect(event.targetId).toBe('c1');
  });

  it('never stores body values', async () => {
    const request = makeRequest({ params: { id: 'c1' }, body: { name: 'Ana Silva', taxId: '123456789' } });

    await run(Dummy.prototype.update, request, { handle: () => of({ id: 'c1' }) });

    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/Ana Silva|123456789/);
  });

  it('records the real admin when the session is an impersonation', async () => {
    const request = makeRequest({ params: { id: 'c1' }, user: { id: 'u1', email: 'u@x.y', impersonatedBy: 'admin-0' } });

    await run(Dummy.prototype.remove, request, { handle: () => of(undefined) });

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u1', impersonatedById: 'admin-0' }));
  });

  it('records a failure with the HTTP status, rethrows, and marks the request as recorded', async () => {
    const request = makeRequest({ params: { id: 'c1' }, body: { taxId: '123456789' } });
    const error = new ConflictException('NIF already in use');

    await expect(run(Dummy.prototype.update, request, { handle: () => throwError(() => error) })).rejects.toBe(error);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customer.update', outcome: 'failure', errorCode: '409', targetId: 'c1' }),
    );
    expect(request.auditRecorded).toBe(true);
  });

  it('records a failed request that has no user as an anonymous actor', async () => {
    const request = makeRequest({ user: undefined });

    await expect(
      run(Dummy.prototype.create, request, { handle: () => throwError(() => new ForbiddenException()) }),
    ).rejects.toBeDefined();

    const event = audit.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(event).not.toHaveProperty('actorId');
    expect(event.errorCode).toBe('403');
  });

  it('records an unexpected error as 500 and still rethrows it', async () => {
    const boom = new Error('boom');

    await expect(run(Dummy.prototype.create, makeRequest(), { handle: () => throwError(() => boom) })).rejects.toBe(boom);

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', errorCode: '500' }));
  });

  it('does not wait for the audit write (best-effort, no added latency)', async () => {
    audit.record.mockReturnValue(new Promise(() => undefined));

    await expect(run(Dummy.prototype.create, makeRequest(), { handle: () => of({ id: 'x' }) })).resolves.toEqual({
      id: 'x',
    });
  });
});
