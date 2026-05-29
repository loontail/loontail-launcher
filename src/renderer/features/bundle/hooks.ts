import type { ClientSlug } from '@shared/contracts/ids';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { type BundleRuntimeState, selectBundle, useBundleStore } from './store';

const MAX_STATUS_SEED_CONCURRENCY = 3;

type StatusSeedResult = Awaited<ReturnType<typeof api.checkStatus>>;

let activeStatusSeedCount = 0;
const statusSeedQueue: Array<() => void> = [];
const statusSeedRequests = new Map<ClientSlug, Promise<StatusSeedResult>>();

const flushStatusSeedQueue = (): void => {
  while (activeStatusSeedCount < MAX_STATUS_SEED_CONCURRENCY) {
    const runSeed = statusSeedQueue.shift();
    if (!runSeed) return;
    activeStatusSeedCount += 1;
    runSeed();
  }
};

const seedStatus = (slug: ClientSlug): Promise<StatusSeedResult> => {
  const existing = statusSeedRequests.get(slug);
  if (existing) return existing;

  const request = new Promise<StatusSeedResult>((resolve, reject) => {
    statusSeedQueue.push(() => {
      void api
        .checkStatus(slug)
        .then(resolve, reject)
        .finally(() => {
          activeStatusSeedCount -= 1;
          flushStatusSeedQueue();
        });
    });
    flushStatusSeedQueue();
  }).finally(() => {
    statusSeedRequests.delete(slug);
  });
  statusSeedRequests.set(slug, request);
  return request;
};

export const useBundleStatus = (slug: ClientSlug | null | undefined): BundleRuntimeState => {
  const state = useBundleStore(selectBundle(slug));

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed if the store has no entry yet.
    if (useBundleStore.getState().entries[slug]) return;
    void seedStatus(slug)
      .then((data) => {
        if (useBundleStore.getState().entries[slug]) return;
        useBundleStore.getState().patch(slug, {
          installed: data.installed,
          signatureMatches: data.signatureMatches,
          progress: data.progress,
        });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: best-effort seed — main logger unreachable from renderer
        console.warn('[bundle] failed to seed status', error);
      });
  }, [slug]);

  return state;
};

export const useStartBundle = () =>
  useMutation({
    mutationFn: ({ slug, force }: { slug: ClientSlug; force?: boolean }) => api.start(slug, force),
  });

const useSlugMutation = <T>(fn: (slug: ClientSlug) => Promise<T>) =>
  useMutation({ mutationFn: fn });

export const usePauseBundle = () => useSlugMutation(api.pause);
export const useResumeBundle = () => useSlugMutation(api.resume);
export const useCancelBundle = () => useSlugMutation(api.cancel);
