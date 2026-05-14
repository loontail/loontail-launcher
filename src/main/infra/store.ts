import { computeDefaultRamMb } from '@main/infra/system';
import { STORE_KEY_AUTH, STORE_KEY_LAUNCHER_SETTINGS } from '@shared/constants';
import type { Account } from '@shared/contracts/account';
import type { LauncherSettings } from '@shared/contracts/settings';
import { defaultLauncherSettings, normalizeLauncherSettings } from '@shared/domain/settings';
import Store from 'electron-store';

type LauncherStoreSchema = {
  [STORE_KEY_AUTH]: {
    jwt: string;
    user: Account;
  } | null;
  [STORE_KEY_LAUNCHER_SETTINGS]: LauncherSettings;
};

const buildDefaultSettings = (): LauncherSettings => {
  const base = defaultLauncherSettings();
  return { ...base, memory: { allocatedRamMb: computeDefaultRamMb() } };
};

const defaults: LauncherStoreSchema = {
  [STORE_KEY_AUTH]: null,
  [STORE_KEY_LAUNCHER_SETTINGS]: buildDefaultSettings(),
};

const store = new Store<LauncherStoreSchema>({
  name: 'launcher',
  defaults,
});

export const getStoredAuth = (): LauncherStoreSchema[typeof STORE_KEY_AUTH] =>
  store.get(STORE_KEY_AUTH);

export const setStoredAuth = (auth: LauncherStoreSchema[typeof STORE_KEY_AUTH]): void => {
  store.set(STORE_KEY_AUTH, auth);
};

export const clearStoredAuth = (): void => {
  store.set(STORE_KEY_AUTH, null);
};

export const getStoredLauncherSettings = (): LauncherSettings =>
  normalizeLauncherSettings(store.get(STORE_KEY_LAUNCHER_SETTINGS));

export const setStoredLauncherSettings = (settings: LauncherSettings): LauncherSettings => {
  const normalized = normalizeLauncherSettings(settings);
  store.set(STORE_KEY_LAUNCHER_SETTINGS, normalized);
  return normalized;
};
