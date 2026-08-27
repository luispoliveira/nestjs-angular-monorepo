import { getCookies } from 'better-auth/cookies';

// apps/auth/src/app.module.ts passes baseURL: configService.get('BETTER_AUTH_URL')
// straight through to betterAuth() with no transformation. This tests the
// better-auth mechanism that wiring depends on: the Secure attribute and the
// __Secure- cookie name prefix are derived from BETTER_AUTH_URL's protocol,
// not from proxy headers (design.md → D1).
//
// Lives under test/*.e2e-spec.ts (not src/*.spec.ts) because it imports a
// real ESM-only better-auth subpath (better-auth/cookies, a .mjs file) —
// the unit jest config's CJS ts-jest transform cannot parse that, while the
// e2e config's --experimental-vm-modules ESM mode handles it natively. No
// database/Redis/Mongo is needed for these two cases.
describe('session cookie Secure attribute derivation from baseURL', () => {
  it('omits Secure and the __Secure- prefix for an http baseURL', () => {
    const { sessionToken } = getCookies({
      baseURL: 'http://localhost:3001/api/auth',
    });

    expect(sessionToken.name).toBe('better-auth.session_token');
    expect(sessionToken.attributes.secure).toBe(false);
    expect(sessionToken.attributes.sameSite).toBe('lax');
    expect(sessionToken.attributes.httpOnly).toBe(true);
  });

  it('sets Secure and the __Secure- prefix for an https baseURL', () => {
    const { sessionToken } = getCookies({
      baseURL: 'https://auth.example.com/api/auth',
    });

    expect(sessionToken.name).toBe('__Secure-better-auth.session_token');
    expect(sessionToken.attributes.secure).toBe(true);
    expect(sessionToken.attributes.sameSite).toBe('lax');
    expect(sessionToken.attributes.httpOnly).toBe(true);
  });
});
