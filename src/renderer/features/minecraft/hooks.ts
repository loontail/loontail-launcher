import { i18n } from '@renderer/i18n';
import { makeSlugMutationHook } from '@renderer/shared/lib/slugMutation';
import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import { QUERY_KEYS } from '@shared/constants';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LoaderChoice } from '@shared/contracts/settings';
import type { IpcError } from '@shared/ipc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { localizeMinecraftError } from './errorCopy';
import { type ClientRuntimeState, selectClient, useMinecraftStore } from './store';

const statusSeeder = createStatusSeeder(api.getStatus);

const minecraftMutationMeta = {
  errorLocalizer: (error: IpcError) => localizeMinecraftError(error.code, error.message, i18n.t),
};

const useSlugMutation = makeSlugMutationHook(minecraftMutationMeta);

export const useClientStatus = (slug: CatalogKey | null | undefined): ClientRuntimeState => {
  const state = useMinecraftStore(selectClient(slug));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed when the store has no entry.
    if (useMinecraftStore.getState().entries[slug]) return;
    void statusSeeder
      .seedStatus(slug)
      .then((data) => {
        if (useMinecraftStore.getState().entries[slug]) return;
        useMinecraftStore.getState().patch(slug, data);
        // A seed can reveal an already-installed client; refetch settings so the
        // settings-derived install presence reflects it.
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
    meta: minecraftMutationMeta,
    mutationFn: ({ slug, loader }: { slug: CatalogKey; loader?: LoaderChoice }) =>
      api.install(slug, loader),
  });

export const usePauseInstall = () => useSlugMutation(api.pauseInstall);
export const useResumeInstall = () => useSlugMutation(api.resumeInstall);
export const useCancelInstall = () => useSlugMutation(api.cancelInstall);
export const useRepairClient = () => useSlugMutation(api.repair);
export const useUninstallClient = () => useSlugMutation(api.uninstall);
export const useLaunchClient = () => useSlugMutation(api.launch);
export const useStopClient = () => useSlugMutation(api.stop);
