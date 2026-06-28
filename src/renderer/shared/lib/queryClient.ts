import { toast } from '@renderer/shared/ui/Toast';
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { type IpcErrorLocalizer, resolveErrorToastMessage } from './errorToast';
import { QUERY_PERSIST_MAX_AGE_MS } from './queryPersister';

const DEFAULT_STALE_TIME_MS = 30_000;

// Refetch on every mount and drop the entry immediately, so the persisted query
// cache can't replay a stale value from a previous main-process build.
export const NEVER_CACHE = { staleTime: 0, gcTime: 0 } as const;

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
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.skipGlobalErrorToast) return;
        const localizer = mutation.meta?.errorLocalizer as IpcErrorLocalizer | undefined;
        toast.error(resolveErrorToastMessage(error, localizer));
      },
    }),
  });
