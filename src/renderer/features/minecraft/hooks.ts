import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import { QUERY_KEYS } from '@shared/constants';
import type { ClientSlug } from '@shared/contracts/ids';
import type { LoaderChoice } from '@shared/contracts/settings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { type ClientRuntimeState, selectClient, useMinecraftStore } from './store';

const statusSeeder = createStatusSeeder(api.getStatus);

export const useClientStatus = (slug: ClientSlug | null | undefined): ClientRuntimeState => {
  const state = useMinecraftStore(selectClient(slug));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed if the store has no entry yet.
    if (useMinecraftStore.getState().entries[slug]) return;
    void statusSeeder
      .seedStatus(slug)
      .then((data) => {
        if (useMinecraftStore.getState().entries[slug]) return;
        useMinecraftStore.getState().patch(slug, data);
        // why: a fresh seed can reveal an already-installed-on-disk client, which
        // changes the settings-derived install presence the account/client UI
        // reads — refetch settings so it reflects the discovered state.
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
