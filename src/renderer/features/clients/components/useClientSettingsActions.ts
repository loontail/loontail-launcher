import {
  openPath,
  useChooseClientFolder,
  useClearClientOverrides,
  useRamPending,
  useSetClientOverride,
} from '@renderer/features/settings';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LoaderChoice, ResolvedClientSettings } from '@shared/contracts/settings';

type UseClientSettingsActionsArgs = {
  slug: CatalogKey;
  resolved: ResolvedClientSettings;
  // Reset identity for the pending RAM value (modal toggle / client switch).
  resetKey: unknown;
};

export const useClientSettingsActions = ({
  slug,
  resolved,
  resetKey,
}: UseClientSettingsActionsArgs) => {
  const { mutate: setClientOverride, isPending: isSavingOverride } = useSetClientOverride();
  const { mutate: clearClientOverrides } = useClearClientOverrides();
  const { mutate: chooseClientFolder } = useChooseClientFolder();

  const ram = useRamPending({
    savedRam: resolved.memory.allocatedRamMb,
    resetKey,
    persist: (allocatedRamMb) => setClientOverride({ slug, patch: { memory: { allocatedRamMb } } }),
  });

  const setLoader = (loader: LoaderChoice) => setClientOverride({ slug, patch: { loader } });

  const toggleConsole = (value: boolean) =>
    setClientOverride({ slug, patch: { launch: { console: value } } });

  const toggleFullscreen = (value: boolean) =>
    setClientOverride({ slug, patch: { launch: { fullscreen: value } } });

  const resetAll = async (): Promise<void> => {
    await clearClientOverrides(slug);
    ram.reset();
  };

  const changeFolder = () => chooseClientFolder(slug);

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
