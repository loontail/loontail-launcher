import { QUERY_KEY_ROOTS } from '@shared/constants';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

const STORAGE_KEY = 'loontail-query-cache-v1';
export const QUERY_PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 1000;

// Roots whose values should always be refetched on launch — never persist them.
// `app` must be volatile: Squirrel can swap the binary under us between launches,
// so the cached version string would otherwise outlive the install it described
// (e.g. UI keeps showing 0.0.11 after auto-update to 0.0.13).
const VOLATILE_QUERY_ROOTS: ReadonlySet<string> = new Set([
  QUERY_KEY_ROOTS.app,
  QUERY_KEY_ROOTS.servers,
]);

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
    shouldDehydrateQuery: (query) => {
      if (query.state.status !== 'success') return false;
      const [root] = query.queryKey;
      if (typeof root === 'string' && VOLATILE_QUERY_ROOTS.has(root)) return false;
      return true;
    },
  },
};
