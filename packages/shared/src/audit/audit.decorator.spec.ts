import { Reflector } from '@nestjs/core';
import { AUDIT_KEY, Audit } from './audit.decorator';

class Dummy {
  @Audit('customer.update', { targetType: 'customer', targetParam: 'customerId', fields: ['name', 'taxId'] })
  update() {}

  @Audit('customer.create', { targetType: 'customer' })
  create() {}

  read() {}
}

describe('@Audit()', () => {
  const reflector = new Reflector();

  it('stores the action and options as handler metadata', () => {
    expect(reflector.get(AUDIT_KEY, Dummy.prototype.update)).toEqual({
      action: 'customer.update',
      targetType: 'customer',
      targetParam: 'customerId',
      fields: ['name', 'taxId'],
    });
  });

  it('works with only a target type', () => {
    expect(reflector.get(AUDIT_KEY, Dummy.prototype.create)).toEqual({
      action: 'customer.create',
      targetType: 'customer',
    });
  });

  it('leaves undecorated handlers without metadata', () => {
    expect(reflector.get(AUDIT_KEY, Dummy.prototype.read)).toBeUndefined();
  });
});
