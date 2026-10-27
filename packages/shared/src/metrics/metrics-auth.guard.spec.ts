import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsAuthGuard } from './metrics-auth.guard';

const makeContext = (authHeader = '') => ({
  switchToHttp: jest.fn().mockReturnValue({
    getRequest: jest.fn().mockReturnValue({
      headers: { authorization: authHeader },
    }),
  }),
}) as unknown as ExecutionContext;

describe('MetricsAuthGuard', () => {
  let guard: MetricsAuthGuard;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>;
    guard = new MetricsAuthGuard(configService);
  });

  it('should allow access when no METRICS_TOKEN is configured', () => {
    configService.get.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('should allow access outside production when NODE_ENV is development and no token is set', () => {
    configService.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'development' : undefined,
    );
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('should deny access in production when no METRICS_TOKEN is configured', () => {
    configService.get.mockImplementation((key: string) =>
      key === 'NODE_ENV' ? 'production' : undefined,
    );
    expect(guard.canActivate(makeContext())).toBe(false);
    expect(guard.canActivate(makeContext('Bearer anything'))).toBe(false);
  });

  it('should allow access when Authorization header matches the token', () => {
    configService.get.mockReturnValue('my-secret');
    expect(guard.canActivate(makeContext('Bearer my-secret'))).toBe(true);
  });

  it('should deny access when Authorization header does not match the token', () => {
    configService.get.mockReturnValue('my-secret');
    expect(guard.canActivate(makeContext('Bearer wrong-token'))).toBe(false);
  });

  it('should deny access when Authorization header is empty and token is set', () => {
    configService.get.mockReturnValue('my-secret');
    expect(guard.canActivate(makeContext(''))).toBe(false);
  });
});
