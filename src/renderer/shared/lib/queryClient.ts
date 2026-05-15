import { QueryClient } from '@tanstack/react-query';
import { QUERY_PERSIST_MAX_AGE_MS } from './queryPersister';

const DEFAULT_STALE_TIME_MS = 30_000;

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        // gcTime must be ≥ persistence maxAge so idle queries are not evicted from
        // memory before the persister snapshots them to disk.
        gcTime: QUERY_PERSIST_MAX_AGE_MS,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
