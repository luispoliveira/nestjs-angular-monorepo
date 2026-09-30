import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';
import { AUTH_RPC_TIMEOUT_MS } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators';
import { ContextUtil } from '../utils';
import { MicroserviceAuthGuard } from './microservice-auth.guard';

jest.mock('../utils', () => ({
  ContextUtil: { extractToken: jest.fn() },
}));

const makeContext = (isPublic: boolean, authHeader?: string) => {
  const getHandler = jest.fn();
  const getClass = jest.fn();
  const getRequest = jest.fn().mockReturnValue({
    headers: authHeader ? { authorization: authHeader } : {},
    cookies: {},
  });
  return {
    getHandler,
    getClass,
    getType: jest.fn().mockReturnValue('http'),
    switchToHttp: jest.fn().mockReturnValue({ getRequest }),
  } as unknown as ExecutionContext;
};

describe('MicroserviceAuthGuard', () => {
  let guard: MicroserviceAuthGuard;
  let authClient: jest.Mocked<ClientProxy>;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    authClient = {
      send: jest.fn(),
    } as unknown as jest.Mocked<ClientProxy>;

    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new MicroserviceAuthGuard(authClient, reflector);
    jest.clearAllMocks();
  });

  it('should return true immediately for public routes', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = makeContext(true);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(authClient.send).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when no token is found', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    (ContextUtil.extractToken as jest.Mock).mockReturnValue(null);
    const context = makeContext(false);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(authClient.send).not.toHaveBeenCalled();
  });

  it('should return true and attach user when auth succeeds', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    reflector.getAllAndOverride.mockReturnValue(false);
    (ContextUtil.extractToken as jest.Mock).mockReturnValue('valid-token');
    authClient.send.mockReturnValue(of(mockUser) as ReturnType<ClientProxy['send']>);

    const context = makeContext(false, 'Bearer valid-token');
    const result$ = guard.canActivate(context) as ReturnType<typeof of>;
    const result = await firstValueFrom(result$);

    expect(result).toBe(true);
  });

  describe('auth service failures', () => {
    const run = (send: ReturnType<ClientProxy['send']>) => {
      reflector.getAllAndOverride.mockReturnValue(false);
      (ContextUtil.extractToken as jest.Mock).mockReturnValue('a-token');
      authClient.send.mockReturnValue(send);
      return guard.canActivate(makeContext(false, 'Bearer a-token')) as ReturnType<
        typeof of
      >;
    };

    it('maps a 401 reply from auth to UnauthorizedException', async () => {
      const result$ = run(
        throwError(() => ({ status: 401, message: 'Unauthorized' })) as ReturnType<
          ClientProxy['send']
        >,
      );

      await expect(firstValueFrom(result$)).rejects.toThrow(UnauthorizedException);
    });

    it('maps a connection error to ServiceUnavailableException', async () => {
      const result$ = run(
        throwError(() => new Error('ECONNREFUSED')) as ReturnType<ClientProxy['send']>,
      );

      await expect(firstValueFrom(result$)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('maps no reply within the bound to ServiceUnavailableException', async () => {
      jest.useFakeTimers();
      try {
        const result$ = run(NEVER as ReturnType<ClientProxy['send']>);
        const settled = expect(firstValueFrom(result$)).rejects.toThrow(
          ServiceUnavailableException,
        );
        await jest.advanceTimersByTimeAsync(AUTH_RPC_TIMEOUT_MS + 1);
        await settled;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('should check IS_PUBLIC_KEY on handler and class', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = makeContext(true);

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.any(Array),
    );
  });
});
