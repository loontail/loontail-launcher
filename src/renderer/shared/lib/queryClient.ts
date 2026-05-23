import { toast } from '@renderer/shared/ui/Toast';
import { isIpcError } from '@shared/ipc';
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { QUERY_PERSIST_MAX_AGE_MS } from './queryPersister';

const DEFAULT_STALE_TIME_MS = 30_000;

// Best-effort string for arbitrary error shapes — covers IpcError ({code,
// message}), Error instances, and as a last resort anything with a string
// `message` so plain throw-objects never collapse to "[object Object]".
const formatError = (error: unknown): string => {
  if (isIpcError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const maybe = (error as Record<string, unknown>).message;
    if (typeof maybe === 'string' && maybe.length > 0) return maybe;
  }
  return String(error);
};

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
    // v5 routes global mutation handlers through MutationCache. `defaultOptions.
    // mutations.onError` is per-mutation default that any local onError shadows,
    // and `mutateAsync` rejections also skip it; MutationCache.onError fires for
    // every mutation regardless of how the caller awaits it.
    mutationCache: new MutationCache({
      onError: (error) => {
        toast.error(formatError(error));
      },
    }),
  });
