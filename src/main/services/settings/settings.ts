import { getStoredLauncherSettings, setStoredLauncherSettings } from '@main/infra/store';
import type { BundleSlug } from '@shared/contracts/ids';
import type {
  ClientSettingsOverride,
  LauncherSettings,
  PatchLauncherSettings,
} from '@shared/contracts/settings';
import {
  clearClientOverrides as clearClientOverridesPure,
  setClientOverride as setClientOverridePure,
} from '@shared/domain/settings';

export const getSettings = (): LauncherSettings => getStoredLauncherSettings();

export const writeSettings = (next: LauncherSettings): LauncherSettings =>
  setStoredLauncherSettings(next);

export const patchLauncherSettings = (patch: PatchLauncherSettings): LauncherSettings => {
  const current = getSettings();
  const next: LauncherSettings = {
    memory: { ...current.memory },
    storage: { ...current.storage },
    launch: { ...current.launch },
    clients: current.clients,
  };

  if (patch.memory?.allocatedRamMb !== undefined) {
    next.memory.allocatedRamMb = patch.memory.allocatedRamMb;
  }
  if (patch.storage?.clientsFolder !== undefined) {
    next.storage.clientsFolder = patch.storage.clientsFolder;
  }
  if (patch.launch?.console !== undefined) {
    next.launch.console = patch.launch.console;
  }
  if (patch.launch?.fullscreen !== undefined) {
    next.launch.fullscreen = patch.launch.fullscreen;
  }

  return writeSettings(next);
};

export const setClientOverride = (
  bundleSlug: BundleSlug,
  patch: ClientSettingsOverride,
): LauncherSettings => writeSettings(setClientOverridePure(getSettings(), bundleSlug, patch));

export const clearClientOverride = (bundleSlug: BundleSlug): LauncherSettings =>
  writeSettings(clearClientOverridesPure(getSettings(), bundleSlug));
