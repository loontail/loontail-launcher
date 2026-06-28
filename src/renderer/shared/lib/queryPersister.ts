import { QUERY_KEY_ROOTS } from '@shared/constants';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Query } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

const STORAGE_KEY = 'loontail-query-cache-v1';
export const QUERY_PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 1000;

// Only offline-first roots are persisted: the catalog the user browses, their
// settings, the cached session, and last-played history. Everything else
// (system probes, build metadata, media, app version, server statuses) must be
// refetched on launch, so an allow-list keeps the localStorage payload small
// and prevents a stale snapshot from a previous build replaying into new code.
const PERSISTED_QUERY_ROOTS: ReadonlySet<string> = new Set([
  QUERY_KEY_ROOTS.catalog,
  QUERY_KEY_ROOTS.settings,
  QUERY_KEY_ROOTS.auth,
  QUERY_KEY_ROOTS.history,
]);

export const shouldDehydrateQuery = (query: Query): boolean => {
  if (query.state.status !== 'success') return false;
  const [root] = query.queryKey;
  return typeof root === 'string' && PERSISTED_QUERY_ROOTS.has(root);
};

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: STORAGE_KEY,
  throttleTime: THROTTLE_MS,
});

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: QUERY_PERSIST_MAX_AGE_MS,
  buster: STORAGE_KEY,
  dehydrateOptions: {
    shouldDehydrateQuery,
  },
};
