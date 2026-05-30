import type { ClientSlug } from '@shared/contracts/ids';
import * as api from './api';

const MAX_STATUS_SEED_CONCURRENCY = 3;

type StatusSeedResult = Awaited<ReturnType<typeof api.checkStatus>>;
type CheckStatus = (slug: ClientSlug) => Promise<StatusSeedResult>;

export type StatusSeeder = {
  seedStatus: (slug: ClientSlug) => Promise<StatusSeedResult>;
  reset: () => void;
};

export const createStatusSeeder = (
  checkStatus: CheckStatus = api.checkStatus,
  maxConcurrency: number = MAX_STATUS_SEED_CONCURRENCY,
): StatusSeeder => {
  let activeCount = 0;
  const queue: Array<() => void> = [];
  const requests = new Map<ClientSlug, Promise<StatusSeedResult>>();

  const flush = (): void => {
    while (activeCount < maxConcurrency) {
      const runSeed = queue.shift();
      if (!runSeed) return;
      activeCount += 1;
      runSeed();
    }
  };

  const seedStatus = (slug: ClientSlug): Promise<StatusSeedResult> => {
    const existing = requests.get(slug);
    if (existing) return existing;

    const request = new Promise<StatusSeedResult>((resolve, reject) => {
      queue.push(() => {
        void checkStatus(slug)
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

export const statusSeeder = createStatusSeeder();
