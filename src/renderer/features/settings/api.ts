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
  bundleSlug: string,
  patch: ClientSettingsOverride,
): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsSetClientOverride, { bundleSlug, patch });

export const clearClientOverrides = (bundleSlug: string): Promise<LauncherSettings> =>
  window.api.invoke(IPC_CHANNELS.settingsClearClientOverrides, bundleSlug);

export const chooseClientFolder = (
  bundleSlug: string,
): Promise<{ settings: LauncherSettings; installed: boolean } | null> =>
  window.api.invoke(IPC_CHANNELS.settingsChooseClientFolder, bundleSlug);
