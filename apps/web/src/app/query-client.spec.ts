import { createQueryClient } from './query-client';

describe('createQueryClient', () => {
  it('serves a repeated query from cache within the 60s staleTime window', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn().mockResolvedValue('value');

    await client.fetchQuery({ queryKey: ['thing'], queryFn });
    await client.fetchQuery({ queryKey: ['thing'], queryFn });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 60s staleTime window has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const client = createQueryClient();
      const queryFn = vi.fn().mockResolvedValue('value');

      await client.fetchQuery({ queryKey: ['thing'], queryFn });
      vi.advanceTimersByTime(60 * 1000 + 1);
      await client.fetchQuery({ queryKey: ['thing'], queryFn });

      expect(queryFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
