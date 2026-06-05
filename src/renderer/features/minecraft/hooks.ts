import { QUERY_KEYS } from '@shared/constants';
import type { ClientSlug } from '@shared/contracts/ids';
import type { LoaderChoice } from '@shared/contracts/settings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { type ClientRuntimeState, selectClient, useMinecraftStore } from './store';

const MAX_STATUS_SEED_CONCURRENCY = 3;

type StatusSeedResult = Awaited<ReturnType<typeof api.getStatus>>;

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
        .getStatus(slug)
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

export const useClientStatus = (slug: ClientSlug | null | undefined): ClientRuntimeState => {
  const state = useMinecraftStore(selectClient(slug));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed if the store has no entry yet.
    if (useMinecraftStore.getState().entries[slug]) return;
    void seedStatus(slug)
      .then((data) => {
        if (useMinecraftStore.getState().entries[slug]) return;
        useMinecraftStore.getState().patch(slug, data);
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settings.root });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: best-effort seed — main logger unreachable from renderer
        console.warn('[minecraft] failed to seed status', error);
      });
  }, [queryClient, slug]);

  return state;
};

export const useInstallClient = () =>
  useMutation({
    mutationFn: ({ slug, loader }: { slug: ClientSlug; loader?: LoaderChoice }) =>
      api.install(slug, loader),
  });

const useSlugMutation = <T>(fn: (slug: ClientSlug) => Promise<T>) =>
  useMutation({ mutationFn: fn });

export const usePauseInstall = () => useSlugMutation(api.pauseInstall);
export const useResumeInstall = () => useSlugMutation(api.resumeInstall);
export const useCancelInstall = () => useSlugMutation(api.cancelInstall);
export const useRepairClient = () => useSlugMutation(api.repair);
export const useUninstallClient = () => useSlugMutation(api.uninstall);
export const useLaunchClient = () => useSlugMutation(api.launch);
export const useStopClient = () => useSlugMutation(api.stop);
