import type { CatalogKey } from '@shared/contracts/ids';
import type {
  ClientSettingsOverride,
  LauncherSettings,
  PatchLauncherSettings,
} from '@shared/contracts/settings';
import { IPC_CHANNELS } from '@shared/ipc';

export const getSettings = (): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsGet, undefined);

export const setLauncher = (patch: PatchLauncherSettings): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsSetLauncher, patch);

export const setClientOverride = (
  key: CatalogKey,
  patch: ClientSettingsOverride,
): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsSetClientOverride, { slug: key, patch });

export const clearClientOverrides = (key: CatalogKey): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsClearClientOverrides, key);

export const chooseClientFolder = (
  key: CatalogKey,
): Promise<{ settings: LauncherSettings; installed: boolean } | null> =>
  window.api.invoke(IPC_CHANNELS.settingsChooseClientFolder, key);
