import { join } from 'node:path';
import { getStoredLauncherSettings, setStoredLauncherSettings } from '@main/infra/store';
import type {
  ClientRuntimeRef,
  ClientSettingsOverride,
  LauncherSettings,
  PatchLauncherSettings,
} from '@shared/contracts/settings';
import {
  clearClientOverrides as clearClientOverridesPure,
  removeClientEntry as removeClientEntryPure,
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
  bundleSlug: string,
  patch: ClientSettingsOverride,
): LauncherSettings => writeSettings(setClientOverridePure(getSettings(), bundleSlug, patch));

export const clearClientOverride = (bundleSlug: string): LauncherSettings =>
  writeSettings(clearClientOverridesPure(getSettings(), bundleSlug));

export const removeClientEntry = (bundleSlug: string): LauncherSettings =>
  writeSettings(removeClientEntryPure(getSettings(), bundleSlug));

export const getClientBundleDir = (bundleSlug: string): string => {
  const settings = getSettings();
  const override = settings.clients[bundleSlug]?.storage?.clientFolder;
  if (override) return override;
  if (!settings.storage.clientsFolder) return '';
  return join(settings.storage.clientsFolder, bundleSlug);
};

export const getClientsFolder = (): string => getSettings().storage.clientsFolder;

export const getClientRuntime = (bundleSlug: string): ClientRuntimeRef | undefined =>
  getSettings().clients[bundleSlug]?.runtime;

export const setClientRuntime = (bundleSlug: string, runtime: ClientRuntimeRef): void => {
  const current = getSettings();
  const existing = current.clients[bundleSlug] ?? {};
  if (
    existing.runtime?.component === runtime.component &&
    existing.runtime?.path === runtime.path
  ) {
    return;
  }
  const next: ClientSettingsOverride = { ...existing, runtime };
  writeSettings({ ...current, clients: { ...current.clients, [bundleSlug]: next } });
};
