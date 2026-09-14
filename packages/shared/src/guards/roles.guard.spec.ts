import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from '@repo/shared-types';
import { ROLES_KEY } from '../decorators';
import { RolesGuard } from './roles.guard';

const makeContext = (user?: { role?: RoleEnum }) => {
  const getRequest = jest.fn().mockReturnValue({ user });
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({ getRequest }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new RolesGuard(reflector);
  });

  it('should allow the request when no roles metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext({ role: RoleEnum.USER });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow the request when the user has a matching role', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);
    const context = makeContext({ role: RoleEnum.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject the request when the user does not have a matching role', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);
    const context = makeContext({ role: RoleEnum.USER });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should reject the request when there is no authenticated user', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should check ROLES_KEY on handler and class', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext({ role: RoleEnum.USER });

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });
});
