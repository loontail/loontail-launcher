import { i18n } from '@renderer/i18n';
import { makeKeyMutationHook } from '@renderer/shared/lib/keyMutation';
import { makeSeededStatusHook } from '@renderer/shared/lib/makeSeededStatusHook';
import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import { QUERY_KEYS } from '@shared/constants';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LoaderChoice } from '@shared/contracts/settings';
import type { IpcError } from '@shared/ipc';
import { useMutation } from '@tanstack/react-query';
import * as api from './api';
import { localizeMinecraftError } from './errorCopy';
import { selectBuild, useMinecraftStore } from './store';

const minecraftMutationMeta = {
  errorLocalizer: (error: IpcError) => localizeMinecraftError(error.code, error.message, i18n.t),
};

const useKeyMutation = makeKeyMutationHook(minecraftMutationMeta);

export const useClientStatus = makeSeededStatusHook({
  store: { useStore: useMinecraftStore, selectEntry: selectBuild },
  seeder: createStatusSeeder(api.getStatus),
  toPatch: (data) => data,
  label: 'minecraft',
  // A seed can reveal an already-installed client; refetch settings so the
  // settings-derived install presence reflects it.
  onSeeded: (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settings.root });
  },
});

export const useInstallClient = () =>
  useMutation({
    meta: minecraftMutationMeta,
    mutationFn: ({ key, loader }: { key: CatalogKey; loader?: LoaderChoice }) =>
      api.install(key, loader),
  });

export const usePauseInstall = () => useKeyMutation(api.pause);
export const useResumeInstall = () => useKeyMutation(api.resume);
export const useCancelInstall = () => useKeyMutation(api.cancel);
export const useRepairClient = () => useKeyMutation(api.repair);
export const useUninstallClient = () => useKeyMutation(api.uninstall);
export const useLaunchClient = () => useKeyMutation(api.launch);
export const useStopClient = () => useKeyMutation(api.stop);
