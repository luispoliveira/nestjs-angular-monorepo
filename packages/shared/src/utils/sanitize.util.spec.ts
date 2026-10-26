import { SanitizeUtil } from './sanitize.util';

describe('SanitizeUtil', () => {
  describe('sanitize', () => {
    it('should replace sensitive keys with [SANITIZED]', () => {
      const input = { email: 'user@example.com', password: 'secret123' };
      const result = SanitizeUtil.sanitize(input);
      expect(result.password).toBe('[SANITIZED]');
      expect(result.email).toBe('user@example.com');
    });

    it('should sanitize nested objects recursively', () => {
      const input = {
        user: { name: 'Alice', token: 'abc', nested: { secret: 'shh' } },
      };
      const result = SanitizeUtil.sanitize(input);
      expect(result.user.token).toBe('[SANITIZED]');
      expect(result.user.nested.secret).toBe('[SANITIZED]');
      expect(result.user.name).toBe('Alice');
    });

    it('should sanitize case-insensitively (authorization header)', () => {
      const input = { Authorization: 'Bearer token' };
      const result = SanitizeUtil.sanitize(input);
      expect(result.Authorization).toBe('[SANITIZED]');
    });

    it('should redact compound keys by normalised substring', () => {
      const input = {
        clientSecret: 's',
        x_api_key: 'k',
        'refresh-token': 't',
        name: 'Ana',
      };
      const result = SanitizeUtil.sanitize(input);
      expect(result.clientSecret).toBe('[SANITIZED]');
      expect(result.x_api_key).toBe('[SANITIZED]');
      expect(result['refresh-token']).toBe('[SANITIZED]');
      expect(result.name).toBe('Ana');
    });

    it('should redact a nested newPassword key', () => {
      const result = SanitizeUtil.sanitize({
        user: { newPassword: 'p', email: 'a@b.c' },
      });
      expect(result.user.newPassword).toBe('[SANITIZED]');
      expect(result.user.email).toBe('a@b.c');
    });

    it('should return the same value when input is falsy', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(SanitizeUtil.sanitize(null as any)).toBeNull();
    });

    it('should not mutate the original object', () => {
      const input = { password: 'secret' };
      SanitizeUtil.sanitize(input);
      expect(input.password).toBe('secret');
    });

    it('should handle x-api-key sensitive key', () => {
      const input = { 'x-api-key': 'my-key', data: 'value' };
      const result = SanitizeUtil.sanitize(input);
      expect(result['x-api-key']).toBe('[SANITIZED]');
      expect(result.data).toBe('value');
    });

    it('should sanitize taxId (protected PII) case-insensitively', () => {
      const input = { name: 'Ana', taxId: '123456789' };
      const result = SanitizeUtil.sanitize(input);
      expect(result.taxId).toBe('[SANITIZED]');
      expect(result.name).toBe('Ana');
    });

    it('should sanitize taxId inside paginated response items', () => {
      const input = {
        items: [{ id: 'c1', taxId: '123456789' }, { id: 'c2', taxId: null }],
      };
      const result = SanitizeUtil.sanitize(input);
      expect(result.items[0].taxId).toBe('[SANITIZED]');
      expect(result.items[1].taxId).toBe('[SANITIZED]');
      expect(result.items[0].id).toBe('c1');
    });

    it('should not sanitize non-sensitive string values in nested objects', () => {
      const input = { config: { host: 'localhost', port: 5432 } };
      const result = SanitizeUtil.sanitize(input);
      expect(result.config.host).toBe('localhost');
    });
  });

  describe('sanitizeUrl', () => {
    it('redacts the search query parameter value', () => {
      expect(
        SanitizeUtil.sanitizeUrl('/api/v1/customers?skip=0&search=123456789'),
      ).toBe('/api/v1/customers?skip=0&search=[SANITIZED]');
    });

    it('matches the parameter name case-insensitively', () => {
      expect(SanitizeUtil.sanitizeUrl('/x?Search=ana')).toBe(
        '/x?Search=[SANITIZED]',
      );
    });

    it('keeps the path and other parameters untouched', () => {
      expect(
        SanitizeUtil.sanitizeUrl('/api/v1/customers?take=20&sortBy=name'),
      ).toBe('/api/v1/customers?take=20&sortBy=name');
    });

    it('returns a URL without a query string unchanged', () => {
      expect(SanitizeUtil.sanitizeUrl('/api/v1/customers/c1')).toBe(
        '/api/v1/customers/c1',
      );
    });
  });
});
