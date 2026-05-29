import { QUERY_KEYS } from '@shared/constants';
import type { ClientSlug } from '@shared/contracts/ids';
import type { LoaderChoice } from '@shared/contracts/settings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { type ClientRuntimeState, selectClient, useMinecraftStore } from './store';

export const useClientStatus = (slug: ClientSlug | null | undefined): ClientRuntimeState => {
  const state = useMinecraftStore(selectClient(slug));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!slug) return;
    // Only seed when the store has no entry for this slug yet. Live IPC events
    // are the source of truth — never let a stale fetch clobber them.
    if (useMinecraftStore.getState().entries[slug]) return;
    void api
      .getStatus(slug)
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
