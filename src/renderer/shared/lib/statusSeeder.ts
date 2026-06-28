import type { CatalogKey } from '@shared/contracts/ids';
import { createLimiter } from '@shared/lib/limiter';

const DEFAULT_MAX_CONCURRENCY = 3;

export type StatusSeeder<TResult> = {
  seedStatus: (slug: CatalogKey) => Promise<TResult>;
  reset: () => void;
};

// A bounded-concurrency, per-slug-deduped status prefetcher. Live IPC events are
// the source of truth; this only fills the initial gap before the first event,
// so concurrent mounts of N build cards don't fire N simultaneous status IPCs.
// Generic over the fetched shape so both the bundle and minecraft features share
// one implementation, each instantiated with its own status fetcher. The pool is
// the shared `createLimiter` primitive; this layers a per-slug dedup map on top.
export const createStatusSeeder = <TResult>(
  fetchStatus: (slug: CatalogKey) => Promise<TResult>,
  maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
): StatusSeeder<TResult> => {
  let limit = createLimiter(maxConcurrency);
  const requests = new Map<CatalogKey, Promise<TResult>>();

  const seedStatus = (slug: CatalogKey): Promise<TResult> => {
    const existing = requests.get(slug);
    if (existing) return existing;

    const request = limit(() => fetchStatus(slug)).finally(() => {
      requests.delete(slug);
    });
    requests.set(slug, request);
    return request;
  };

  return {
    seedStatus,
    // A fresh limiter abandons any queued (not-yet-started) work so the next
    // seed starts from an empty pool, matching the prior hand-rolled reset.
    reset: () => {
      limit = createLimiter(maxConcurrency);
      requests.clear();
    },
  };
};
