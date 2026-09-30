import * as Sentry from '@sentry/nestjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SentryUtil } from './sentry.util';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

describe('SentryUtil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENTRY_DSN;
    delete process.env.NODE_ENV;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  });

  describe('init', () => {
    it('should not call Sentry.init when SENTRY_DSN is not set', () => {
      SentryUtil.init('my-app');
      expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('should call Sentry.init when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      SentryUtil.init('my-app');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://test@sentry.io/123',
          initialScope: expect.objectContaining({ tags: { app: 'my-app' } }),
        }),
      );
    });

    it('should use NODE_ENV as environment when set', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      process.env.NODE_ENV = 'production';
      SentryUtil.init('worker');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'production' }),
      );
    });

    it('should fall back to development when NODE_ENV is not set', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      SentryUtil.init('worker');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'development' }),
      );
    });
  });

  describe('init — .env loading', () => {
    const originalCwd = process.cwd();
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'sentry-util-'));
      process.chdir(dir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    });

    it('should read SENTRY_DSN from .env when absent from the environment', () => {
      writeFileSync('.env', 'SENTRY_DSN=https://file@sentry.io/1\n');
      SentryUtil.init('api');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ dsn: 'https://file@sentry.io/1' }),
      );
    });

    it('should prefer the process environment over .env', () => {
      writeFileSync('.env', 'SENTRY_DSN=https://file@sentry.io/1\n');
      process.env.SENTRY_DSN = 'https://env@sentry.io/2';
      SentryUtil.init('api');
      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ dsn: 'https://env@sentry.io/2' }),
      );
    });

    it('should not throw when there is no .env file', () => {
      expect(() => SentryUtil.init('api')).not.toThrow();
      expect(Sentry.init).not.toHaveBeenCalled();
    });
  });

  describe('init — tracesSampler', () => {
    type Sampler = (ctx: {
      name: string;
      normalizedRequest?: { url?: string };
    }) => number;

    function sampler(rate?: string): Sampler {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      if (rate !== undefined) process.env.SENTRY_TRACES_SAMPLE_RATE = rate;
      SentryUtil.init('api');
      const [[options]] = (Sentry.init as jest.Mock).mock.calls as [
        [{ tracesSampler: Sampler }],
      ];
      return options.tracesSampler;
    }

    it('should return the configured rate for application routes', () => {
      expect(
        sampler('0.25')({
          name: 'GET /api/v1/users',
          normalizedRequest: {
            url: 'http://localhost:3000/api/v1/users?take=5',
          },
        }),
      ).toBe(0.25);
    });

    it.each(['/health/live', '/health/ready', '/metrics', '/favicon.ico'])(
      'should never sample %s',
      (path) => {
        expect(
          sampler('1')({
            name: `GET ${path}`,
            normalizedRequest: { url: path },
          }),
        ).toBe(0);
      },
    );

    it('should fall back to the span name when there is no request', () => {
      expect(sampler('1')({ name: 'GET /health/live' })).toBe(0);
      expect(sampler('1')({ name: 'GET /api/v1/users' })).toBe(1);
    });

    it('should not treat a path that merely starts with a silent prefix as silent', () => {
      expect(sampler('1')({ name: 'GET /healthcheck-report' })).toBe(1);
    });

    it.each([
      [undefined, 0],
      ['abc', 0],
      ['-1', 0],
      ['5', 1],
    ])('should clamp SENTRY_TRACES_SAMPLE_RATE=%s to %s', (rate, expected) => {
      expect(sampler(rate)({ name: 'GET /api/v1/users' })).toBe(expected);
    });
  });

  describe('captureException', () => {
    it('should call Sentry.captureException with the exception', () => {
      const err = new Error('test error');
      SentryUtil.captureException(err);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, undefined);
    });

    it('should forward extra context when provided', () => {
      const err = new Error('test');
      const ctx = { extra: { userId: '123' }, tags: { source: 'worker' } };
      SentryUtil.captureException(err, ctx);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, ctx);
    });
  });
});
