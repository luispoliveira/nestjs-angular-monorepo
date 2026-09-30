import { isSilentPath } from './observability';

describe('isSilentPath', () => {
  it.each([
    '/health',
    '/api/health/live',
    '/api/health/ready?x=1',
    '/metrics',
    '/api/metrics?x=1',
    '/favicon.ico',
  ])('silences %s', (path) => {
    expect(isSilentPath(path)).toBe(true);
  });

  it.each(['/api/healthcheck', '/api/users/metrics-report', '/api/users', '/'])(
    'keeps %s',
    (path) => {
      expect(isSilentPath(path)).toBe(false);
    },
  );
});
