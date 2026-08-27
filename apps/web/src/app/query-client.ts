import { QueryClient } from '@tanstack/angular-query-experimental';

/**
 * 1s default `staleTime`, matching the pre-migration React Query config
 * (design.md → D7) — a repeated query within the window is served from
 * cache instead of refetching.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 1 * 1000 } } });
}
