import { INestApplication } from '@nestjs/common';
import { BootstrapUtil } from './bootstrap.util';

const makeApp = () => {
  const expressInstanceSet = jest.fn();
  const app = {
    setGlobalPrefix: jest.fn(),
    useLogger: jest.fn(),
    use: jest.fn(),
    enableVersioning: jest.fn(),
    enableCors: jest.fn(),
    getHttpAdapter: jest.fn(() => ({
      getInstance: () => ({ set: expressInstanceSet }),
    })),
    get: jest.fn(),
  } as unknown as INestApplication;
  return { app, expressInstanceSet };
};

const baseConfig = {
  globalPrefix: 'api',
  useHelmet: false,
  enableVersioning: false,
  enableCookieParser: false,
  cors: { credentials: true, origin: 'https://admin.example.com' },
};

describe('BootstrapUtil', () => {
  describe('CORS origin handling', () => {
    it('splits a comma-joined origin string into a trimmed array', () => {
      const { app } = makeApp();

      BootstrapUtil.setup(app, {
        ...baseConfig,
        cors: {
          credentials: true,
          origin: 'https://admin.example.com, https://client.example.com,https://talent.example.com',
        },
      });

      expect(app.enableCors).toHaveBeenCalledWith({
        origin: [
          'https://admin.example.com',
          'https://client.example.com',
          'https://talent.example.com',
        ],
        credentials: true,
      });
    });

    it('wraps a single origin string in a one-element array', () => {
      const { app } = makeApp();

      BootstrapUtil.setup(app, {
        ...baseConfig,
        cors: { credentials: true, origin: 'https://admin.example.com' },
      });

      expect(app.enableCors).toHaveBeenCalledWith({
        origin: ['https://admin.example.com'],
        credentials: true,
      });
    });

    it('passes an already-array origin through unchanged', () => {
      const { app } = makeApp();

      BootstrapUtil.setup(app, {
        ...baseConfig,
        cors: {
          credentials: true,
          origin: ['https://admin.example.com', 'https://client.example.com'],
        },
      });

      expect(app.enableCors).toHaveBeenCalledWith({
        origin: ['https://admin.example.com', 'https://client.example.com'],
        credentials: true,
      });
    });

    it('never emits the configured value as a single multi-origin string', () => {
      const { app } = makeApp();

      BootstrapUtil.setup(app, {
        ...baseConfig,
        cors: {
          credentials: true,
          origin: 'https://admin.example.com,https://client.example.com',
        },
      });

      const call = (app.enableCors as jest.Mock).mock.calls[0][0];
      expect(typeof call.origin).not.toBe('string');
      expect(Array.isArray(call.origin)).toBe(true);
    });

    it('preserves a literal "*" entry rather than treating it as a wildcard', () => {
      const { app } = makeApp();

      BootstrapUtil.setup(app, {
        ...baseConfig,
        cors: { credentials: true, origin: 'https://admin.example.com,*' },
      });

      // enableCors receives the raw split array — filtering `*` out (because it is a
      // wildcard for better-auth's trustedOrigins, not for cors) is the caller's job.
      expect(app.enableCors).toHaveBeenCalledWith({
        origin: ['https://admin.example.com', '*'],
        credentials: true,
      });
    });
  });

  describe('trust proxy handling', () => {
    it('enables trust proxy on the underlying HTTP adapter when trustProxy is true', () => {
      const { app, expressInstanceSet } = makeApp();

      BootstrapUtil.setup(app, { ...baseConfig, trustProxy: true });

      expect(expressInstanceSet).toHaveBeenCalledWith('trust proxy', 1);
    });

    it('does not touch trust proxy when trustProxy is omitted', () => {
      const { app, expressInstanceSet } = makeApp();

      BootstrapUtil.setup(app, baseConfig);

      expect(expressInstanceSet).not.toHaveBeenCalled();
    });

    it('does not touch trust proxy when trustProxy is false', () => {
      const { app, expressInstanceSet } = makeApp();

      BootstrapUtil.setup(app, { ...baseConfig, trustProxy: false });

      expect(expressInstanceSet).not.toHaveBeenCalled();
    });
  });
});
