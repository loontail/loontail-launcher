import { getStoredLauncherSettings, setStoredLauncherSettings } from '@main/infra/store';
import type { CatalogKey } from '@shared/contracts/ids';
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

// Only overwrites defined patch fields; an omitted section or key is untouched.
const mergeSection = <T extends object>(
  current: T,
  patch: { [K in keyof T]?: T[K] | undefined } | undefined,
): T => {
  if (!patch) return current;
  const next = { ...current };
  for (const key in patch) {
    const value = patch[key as keyof T];
    if (value !== undefined) next[key as keyof T] = value as T[keyof T];
  }
  return next;
};

export const applyLauncherPatch = (
  current: LauncherSettings,
  patch: PatchLauncherSettings,
): LauncherSettings => ({
  memory: mergeSection(current.memory, patch.memory),
  storage: mergeSection(current.storage, patch.storage),
  launch: mergeSection(current.launch, patch.launch),
  clients: current.clients,
});

export const patchLauncherSettings = (patch: PatchLauncherSettings): LauncherSettings =>
  writeSettings(applyLauncherPatch(getSettings(), patch));

export const setClientOverride = (
  key: CatalogKey,
  patch: ClientSettingsOverride,
): LauncherSettings => writeSettings(setClientOverridePure(getSettings(), key, patch));

export const clearClientOverride = (key: CatalogKey): LauncherSettings =>
  writeSettings(clearClientOverridesPure(getSettings(), key));
