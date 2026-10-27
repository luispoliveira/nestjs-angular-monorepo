import { Request } from 'express';
import { ContextUtil } from './context.util';

const makeRequest = (
  authHeader?: string,
  cookies: Record<string, string> = {},
): Request =>
  ({
    headers: authHeader ? { authorization: authHeader } : {},
    cookies,
  }) as unknown as Request;

describe('ContextUtil', () => {
  describe('extractToken', () => {
    it('should extract token from Bearer Authorization header', () => {
      const req = makeRequest('Bearer my-secret-token');
      expect(ContextUtil.extractToken(req)).toBe('my-secret-token');
    });

    it('should return null when Authorization header has no Bearer prefix', () => {
      const req = makeRequest('Basic dXNlcjpwYXNz');
      expect(ContextUtil.extractToken(req)).toBeNull();
    });

    it('should extract token from better-auth.session_token cookie', () => {
      const req = makeRequest(undefined, { 'better-auth.session_token': 'cookie-token' });
      expect(ContextUtil.extractToken(req)).toBe('cookie-token');
    });

    it('should extract token from __Secure-better-auth.session_token cookie', () => {
      const req = makeRequest(undefined, {
        '__Secure-better-auth.session_token': 'secure-cookie-token',
      });
      expect(ContextUtil.extractToken(req)).toBe('secure-cookie-token');
    });

    it('should return null when no token is present', () => {
      const req = makeRequest(undefined, {});
      expect(ContextUtil.extractToken(req)).toBeNull();
    });

    it('should prefer Authorization header over cookie', () => {
      const req = makeRequest('Bearer header-token', {
        'better-auth.session_token': 'cookie-token',
      });
      expect(ContextUtil.extractToken(req)).toBe('header-token');
    });
  });

  describe('newCorrelationId', () => {
    it('has the <timestamp>-<uuid> shape the request middleware uses', () => {
      expect(ContextUtil.newCorrelationId()).toMatch(/^\d{13,}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('is unique per call', () => {
      expect(ContextUtil.newCorrelationId()).not.toBe(ContextUtil.newCorrelationId());
    });
  });

  describe('clientIpFromForwardedFor', () => {
    it('returns undefined without the header', () => {
      expect(ContextUtil.clientIpFromForwardedFor(undefined)).toBeUndefined();
      expect(ContextUtil.clientIpFromForwardedFor(null)).toBeUndefined();
      expect(ContextUtil.clientIpFromForwardedFor('')).toBeUndefined();
    });

    it('returns the only entry', () => {
      expect(ContextUtil.clientIpFromForwardedFor('203.0.113.7')).toBe('203.0.113.7');
    });

    it('takes the entry the trusted proxy appended, not the client-supplied first one', () => {
      // A client sends "6.6.6.6"; nginx ($proxy_add_x_forwarded_for) appends the real address.
      expect(ContextUtil.clientIpFromForwardedFor('6.6.6.6, 198.51.100.9')).toBe('198.51.100.9');
    });

    it('counts hops from the right, like Express trust proxy', () => {
      expect(ContextUtil.clientIpFromForwardedFor('6.6.6.6, 198.51.100.9, 10.0.0.1', 2)).toBe('198.51.100.9');
    });

    it('falls back to the leftmost entry when there are fewer entries than trusted hops', () => {
      expect(ContextUtil.clientIpFromForwardedFor('198.51.100.9', 3)).toBe('198.51.100.9');
    });

    it('trims blanks and ignores empty entries', () => {
      expect(ContextUtil.clientIpFromForwardedFor(' 6.6.6.6 , , 198.51.100.9 ')).toBe('198.51.100.9');
    });

    it.each(['evil<script>', 'not-an-ip', '999.999.999.999', '1.2.3', 'X'.repeat(8000), '203.0.113.7:8080 extra'])(
      'returns undefined when the trusted entry is not an IP address (%#)',
      (entry) => {
        expect(ContextUtil.clientIpFromForwardedFor(`6.6.6.6, ${entry}`)).toBeUndefined();
      },
    );

    it('accepts IPv4 and IPv6 addresses', () => {
      expect(ContextUtil.clientIpFromForwardedFor('203.0.113.7')).toBe('203.0.113.7');
      expect(ContextUtil.clientIpFromForwardedFor('2001:db8::1')).toBe('2001:db8::1');
      expect(ContextUtil.clientIpFromForwardedFor('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    });

    it('only validates the trusted entry, not the client-supplied ones before it', () => {
      expect(ContextUtil.clientIpFromForwardedFor('evil<script>, 198.51.100.9')).toBe('198.51.100.9');
    });

    it('trusts nothing when no proxy hop is trusted', () => {
      expect(ContextUtil.clientIpFromForwardedFor('6.6.6.6', 0)).toBeUndefined();
    });
  });
});
