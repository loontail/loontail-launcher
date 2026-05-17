import { toast } from '@renderer/shared/ui/Toast';
import { isIpcError } from '@shared/ipc';
import { QueryClient } from '@tanstack/react-query';
import { QUERY_PERSIST_MAX_AGE_MS } from './queryPersister';

const DEFAULT_STALE_TIME_MS = 30_000;

const formatError = (error: unknown): string => {
  if (isIpcError(error)) return error.message;
  if (error instanceof Error) return error.message;
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
      mutations: {
        // Anything thrown out of a mutation surfaces as a toast. Mutations that
        // want to silence this (e.g. login, where the form renders its own
        // error copy) supply their own `onError` which runs in addition; toasts
        // can be suppressed by catching there.
        onError: (error) => {
          toast.error(formatError(error));
        },
      },
    },
  });
