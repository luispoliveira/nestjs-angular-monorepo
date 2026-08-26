import { adminClient } from 'better-auth/client/plugins';
import { twoFactorClient } from 'better-auth/plugins';
import { createAuthClient } from 'better-auth/client';
import { webConfig } from '../config/app-config';

/**
 * The vanilla (framework-agnostic) better-auth client — there is no
 * `better-auth/angular` export, but every method here is identical to the
 * React client's; only session state differs (a nanostores atom bridged to
 * an Angular signal by SessionService, not a hook). See design.md → D3.
 *
 * `baseURL` is absolute because the auth service is a separate origin
 * (design.md → D1); the client already defaults to `credentials: 'include'`
 * so the session cookie is sent on every request.
 */
export const authClient = createAuthClient({
  baseURL: webConfig.authApiUrl,
  plugins: [twoFactorClient(), adminClient()],
});
