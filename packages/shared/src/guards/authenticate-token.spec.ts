import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';
import { AUTH_RPC_TIMEOUT_MS, MESSAGE_PATTERNS } from '../constants';
import { authenticateToken } from './authenticate-token';

describe('authenticateToken', () => {
  let authClient: jest.Mocked<ClientProxy>;
  let logger: jest.Mocked<Pick<Logger, 'error'>>;

  const call = (send: ReturnType<ClientProxy['send']>) => {
    authClient.send.mockReturnValue(send);
    return authenticateToken(authClient, 'a-token', logger as unknown as Logger);
  };

  beforeEach(() => {
    authClient = { send: jest.fn() } as unknown as jest.Mocked<ClientProxy>;
    logger = { error: jest.fn() };
  });

  it('sends the token to the auth service and returns the user it answers with', async () => {
    const user = { id: 'user-1', role: 'admin' };

    const result = await firstValueFrom(
      call(of(user) as ReturnType<ClientProxy['send']>),
    );

    expect(result).toEqual(user);
    expect(authClient.send).toHaveBeenCalledWith(
      MESSAGE_PATTERNS.AUTH_AUTHENTICATE,
      { token: 'a-token' },
    );
  });

  it('maps a 401 reply from auth to UnauthorizedException', async () => {
    const result$ = call(
      throwError(() => ({ status: 401 })) as ReturnType<ClientProxy['send']>,
    );

    await expect(firstValueFrom(result$)).rejects.toThrow(UnauthorizedException);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps a connection error to ServiceUnavailableException and logs it', async () => {
    const result$ = call(
      throwError(() => new Error('ECONNREFUSED')) as ReturnType<
        ClientProxy['send']
      >,
    );

    await expect(firstValueFrom(result$)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('maps no reply within the bound to ServiceUnavailableException', async () => {
    jest.useFakeTimers();
    try {
      const result$ = call(NEVER as ReturnType<ClientProxy['send']>);
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
