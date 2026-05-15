import { QueryClient } from '@tanstack/react-query';

const DEFAULT_STALE_TIME_MS = 30_000;
// gc time must be ≥ persistence maxAge so cached queries stick around long enough to be
// dehydrated to disk. Without this, idle queries are evicted from memory before persistence
// snapshots them.
const PERSIST_GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: PERSIST_GC_TIME_MS,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
