import {
  openPath,
  useChooseClientFolder,
  useClearClientOverrides,
  useRamPending,
  useSetClientOverride,
} from '@renderer/features/settings';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LoaderChoice, ResolvedClientSettings } from '@shared/contracts/settings';

type UseBuildSettingsActionsArgs = {
  key: CatalogKey;
  resolved: ResolvedClientSettings;
  resetKey: unknown;
};

export const useBuildSettingsActions = ({
  key,
  resolved,
  resetKey,
}: UseBuildSettingsActionsArgs) => {
  const {
    mutate: setClientOverride,
    mutateAsync: saveClientOverride,
    isPending: isSavingOverride,
  } = useSetClientOverride();
  const { mutateAsync: clearClientOverrides } = useClearClientOverrides();
  const { mutate: chooseClientFolder } = useChooseClientFolder();

  const ram = useRamPending({
    savedRam: resolved.memory.allocatedRamMb,
    resetKey,
    persist: (allocatedRamMb) => saveClientOverride({ key, patch: { memory: { allocatedRamMb } } }),
  });

  const setLoader = (loader: LoaderChoice): void => setClientOverride({ key, patch: { loader } });

  const toggleConsole = (value: boolean): void =>
    setClientOverride({ key, patch: { launch: { console: value } } });

  const toggleFullscreen = (value: boolean): void =>
    setClientOverride({ key, patch: { launch: { fullscreen: value } } });

  const resetAll = async (): Promise<void> => {
    // Awaited form: the local pending RAM value may only be dropped once the
    // stored overrides are actually gone. The global toast reports a failure.
    const cleared = await clearClientOverrides(key).then(
      () => true,
      () => false,
    );
    if (cleared) ram.reset();
  };

  const changeFolder = (): void => chooseClientFolder(key);

  const openFolder = (): void => {
    if (resolved.storage.clientFolder) void openPath(resolved.storage.clientFolder);
  };

  return {
    ram,
    isSavingOverride,
    setLoader,
    toggleConsole,
    toggleFullscreen,
    resetAll,
    changeFolder,
    openFolder,
  };
};
