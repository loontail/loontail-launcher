import type { ClientSlug } from '@shared/contracts/ids';
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
  slug: ClientSlug,
  patch: ClientSettingsOverride,
): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsSetClientOverride, { slug, patch });

export const clearClientOverrides = (slug: ClientSlug): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsClearClientOverrides, slug);

export const chooseClientFolder = (
  slug: ClientSlug,
): Promise<{ settings: LauncherSettings; installed: boolean } | null> =>
  window.api.invoke(IPC_CHANNELS.settingsChooseClientFolder, slug);
