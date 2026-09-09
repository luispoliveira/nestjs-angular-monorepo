describe('pinoConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('emits no transport (plain JSON) in production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';

    const { pinoConfig } = require('./pino.config') as typeof import('./pino.config');

    expect(pinoConfig.pinoHttp?.transport).toBeUndefined();
  });

  it('uses pino-pretty outside production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';

    const { pinoConfig } = require('./pino.config') as typeof import('./pino.config');

    expect(pinoConfig.pinoHttp?.transport).toEqual(
      expect.objectContaining({ target: 'pino-pretty' }),
    );
  });
});
