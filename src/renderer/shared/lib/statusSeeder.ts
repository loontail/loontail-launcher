import type { CatalogKey } from '@shared/contracts/ids';
import { createLimiter } from '@shared/lib/limiter';

const DEFAULT_MAX_CONCURRENCY = 3;

export type StatusSeeder<TResult> = {
  seedStatus: (key: CatalogKey) => Promise<TResult>;
};

// Bounded-concurrency, per-key-deduped status prefetcher. Live IPC events are
// the source of truth; this only fills the gap before the first event so N build
// cards mounting at once don't fire N simultaneous status IPCs.
export const createStatusSeeder = <TResult>(
  fetchStatus: (key: CatalogKey) => Promise<TResult>,
  maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
): StatusSeeder<TResult> => {
  const limit = createLimiter(maxConcurrency);
  const requests = new Map<CatalogKey, Promise<TResult>>();

  const seedStatus = (key: CatalogKey): Promise<TResult> => {
    const existing = requests.get(key);
    if (existing) return existing;

    const request = limit(() => fetchStatus(key)).finally(() => {
      requests.delete(key);
    });
    requests.set(key, request);
    return request;
  };

  return { seedStatus };
};
