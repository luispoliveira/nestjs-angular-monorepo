import type Redis from 'ioredis';

export interface RateLimitRule {
  /** Window length in seconds. */
  window: number;
  /** Max requests allowed within the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets, reported to the client. */
  retryAfter: number | null;
}

// Atomic fixed-window counter: INCR the key, set the TTL on the first hit of
// the window, and read the remaining TTL — all in one round trip so a crash
// can never leave a key without an expiry. Shared in Redis, so the limit holds
// across every auth worker; an in-memory counter would be per-worker and reset
// on reload.
const CONSUME_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

/**
 * Redis-backed `customStorage` for better-auth's rate limiter. Fails open: if
 * Redis is unreachable, requests are allowed rather than taking down login —
 * a brief limiter bypass during a Redis outage beats a full auth outage.
 */
export function createRedisRateLimitStorage(redis: Redis) {
  return {
    consume: async (
      key: string,
      rule: RateLimitRule,
    ): Promise<RateLimitResult> => {
      try {
        const [count, ttl] = (await redis.eval(
          CONSUME_LUA,
          1,
          `rl:${key}`,
          String(rule.window),
        )) as [number, number];

        if (count <= rule.max) {
          return { allowed: true, retryAfter: null };
        }
        return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
      } catch {
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
