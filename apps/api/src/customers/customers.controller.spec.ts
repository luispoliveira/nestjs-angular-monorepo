import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AUDIT_KEY, ROLES_KEY } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { CustomersController } from './customers.controller';

/**
 * Authorization is declarative: the global RolesGuard reads ROLES_KEY
 * metadata. Reads carry none (any authenticated user, via the global
 * MicroserviceAuthGuard); writes require ADMIN.
 */
describe('CustomersController metadata', () => {
  const proto = CustomersController.prototype;
  const rolesOf = (handler: keyof CustomersController) =>
    Reflect.getMetadata(ROLES_KEY, proto[handler]) as RoleEnum[] | undefined;

  it.each(['create', 'update', 'remove'] as const)(
    '%s requires the admin role',
    (handler) => {
      expect(rolesOf(handler)).toEqual([RoleEnum.ADMIN]);
    },
  );

  it.each(['list', 'findOne'] as const)(
    '%s has no role restriction',
    (handler) => {
      expect(rolesOf(handler)).toBeUndefined();
    },
  );

  it('remove responds 204', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.remove)).toBe(204);
  });

  describe('audit metadata', () => {
    const auditOf = (handler: keyof CustomersController) =>
      Reflect.getMetadata(AUDIT_KEY, proto[handler]) as
        { action: string; targetType?: string; fields?: string[] } | undefined;

    it.each([
      ['create', 'customer.create'],
      ['update', 'customer.update'],
      ['remove', 'customer.delete'],
    ] as const)('%s is audited as %s on a customer', (handler, action) => {
      expect(auditOf(handler)).toMatchObject({
        action,
        targetType: 'customer',
      });
    });

    it.each(['create', 'update'] as const)(
      '%s only lists the declared customer fields as changed',
      (handler) => {
        expect(auditOf(handler)?.fields).toEqual([
          'name',
          'email',
          'taxId',
          'notes',
        ]);
      },
    );

    it.each(['list', 'findOne'] as const)(
      '%s (a read) is never audited',
      (handler) => {
        expect(auditOf(handler)).toBeUndefined();
      },
    );
  });
});
