import type { CatalogKey } from '@shared/contracts/ids';

const DEFAULT_MAX_CONCURRENCY = 3;

export type StatusSeeder<TResult> = {
  seedStatus: (slug: CatalogKey) => Promise<TResult>;
  reset: () => void;
};

// A bounded-concurrency, per-slug-deduped status prefetcher. Live IPC events are
// the source of truth; this only fills the initial gap before the first event,
// so concurrent mounts of N build cards don't fire N simultaneous status IPCs.
// Generic over the fetched shape so both the bundle and minecraft features share
// one implementation, each instantiated with its own status fetcher.
export const createStatusSeeder = <TResult>(
  fetchStatus: (slug: CatalogKey) => Promise<TResult>,
  maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
): StatusSeeder<TResult> => {
  let activeCount = 0;
  const queue: Array<() => void> = [];
  const requests = new Map<CatalogKey, Promise<TResult>>();

  const flush = (): void => {
    while (activeCount < maxConcurrency) {
      const runSeed = queue.shift();
      if (!runSeed) return;
      activeCount += 1;
      runSeed();
    }
  };

  const seedStatus = (slug: CatalogKey): Promise<TResult> => {
    const existing = requests.get(slug);
    if (existing) return existing;

    const request = new Promise<TResult>((resolve, reject) => {
      queue.push(() => {
        void fetchStatus(slug)
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            flush();
          });
      });
      flush();
    }).finally(() => {
      requests.delete(slug);
    });
    requests.set(slug, request);
    return request;
  };

  return {
    seedStatus,
    reset: () => {
      activeCount = 0;
      queue.length = 0;
      requests.clear();
    },
  };
};
