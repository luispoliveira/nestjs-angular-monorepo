import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Audit } from './audit.decorator';
import { AuditContextGuard } from './audit-context.guard';

class Dummy {
  @Audit('customer.delete', { targetType: 'customer' })
  remove() {}

  read() {}
}

const contextFor = (handler: () => void, request: Record<string, unknown>) =>
  ({
    getHandler: () => handler,
    getClass: () => Dummy,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('AuditContextGuard', () => {
  const guard = new AuditContextGuard(new Reflector());

  it('copies the handler metadata onto the request and allows', () => {
    const request: Record<string, unknown> = {};

    expect(guard.canActivate(contextFor(Dummy.prototype.remove, request))).toBe(true);

    expect(request.audit).toEqual({ action: 'customer.delete', targetType: 'customer' });
  });

  it('allows without touching the request when the handler is not audited', () => {
    const request: Record<string, unknown> = {};

    expect(guard.canActivate(contextFor(Dummy.prototype.read, request))).toBe(true);

    expect(request).not.toHaveProperty('audit');
  });

  it('never denies, so it cannot change the outcome of the request', () => {
    expect(() => guard.canActivate(contextFor(Dummy.prototype.remove, {}))).not.toThrow();
  });
});
