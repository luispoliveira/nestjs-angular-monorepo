import type Redis from 'ioredis';
import { createRedisRateLimitStorage } from './rate-limit.storage';

const rule = { window: 60, max: 3 };

describe('createRedisRateLimitStorage', () => {
  let redis: { eval: jest.Mock };

  beforeEach(() => {
    redis = { eval: jest.fn() };
  });

  const storage = () => createRedisRateLimitStorage(redis as unknown as Redis);

  it('allows a request within the limit', async () => {
    redis.eval.mockResolvedValue([3, 60]);
    await expect(storage().consume('ip:/sign-in/email', rule)).resolves.toEqual(
      { allowed: true, retryAfter: null },
    );
  });

  it('refuses a request over the limit and reports the seconds left', async () => {
    redis.eval.mockResolvedValue([4, 42]);
    await expect(storage().consume('ip:/sign-in/email', rule)).resolves.toEqual(
      { allowed: false, retryAfter: 42 },
    );
  });

  it('falls back to the window when the key has no TTL', async () => {
    redis.eval.mockResolvedValue([4, -1]);
    const result = await storage().consume('k', rule);
    expect(result.retryAfter).toBe(60);
  });

  it('counts through one atomic script, setting the TTL from the rule window', async () => {
    redis.eval.mockResolvedValue([1, 60]);
    await storage().consume('k', rule);
    const [script, numKeys, key, ttl] = redis.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('EXPIRE'");
    expect(numKeys).toBe(1);
    expect(key).toBe('rl:k');
    expect(ttl).toBe('60');
  });

  it('fails open when Redis is unreachable', async () => {
    redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(storage().consume('k', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });
});
