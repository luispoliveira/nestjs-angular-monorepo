import { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { TRUSTED_PROXY_HOPS } from '../constants/proxy';

const BETTER_AUTH_SESSION_COOKIE_KEYS = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];
export class ContextUtil {
  /**
   * The client address from `X-Forwarded-For`, counting `hops` trusted
   * proxies from the right (Express `trust proxy` semantics). The first
   * entry is whatever the client sent, so it is never trusted by default.
   * An entry that is not an IP address (no proxy in front, or a malformed
   * header) yields `undefined` instead of arbitrary client text.
   */
  static clientIpFromForwardedFor(
    header: string | null | undefined,
    hops: number = TRUSTED_PROXY_HOPS,
  ): string | undefined {
    if (!header || hops < 1) return undefined;
    const entries = header
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const entry = entries[Math.max(0, entries.length - hops)];
    return entry && isIP(entry) ? entry : undefined;
  }

  /** The per-request id threaded through CLS, logs and audit events. */
  static newCorrelationId(): string {
    return `${Date.now()}-${randomUUID()}`;
  }

  static extractToken(req: Request) {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    const cookies = req.cookies as Record<string, string | undefined>;
    for (const key of BETTER_AUTH_SESSION_COOKIE_KEYS) {
      if (cookies?.[key]) {
        return cookies[key];
      }
    }
    return null;
  }
}
