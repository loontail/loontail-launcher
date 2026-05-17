import { scopedLogger } from '@main/infra/logger';
import { computeDefaultRamMb } from '@main/infra/system';
import {
  CURRENT_SCHEMA_VERSION,
  STORE_KEY_AUTH,
  STORE_KEY_LAUNCHER_SETTINGS,
  STORE_KEY_SCHEMA_VERSION,
} from '@shared/constants';
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
  [STORE_KEY_SCHEMA_VERSION]: number;
};

const logger = scopedLogger('store');

const buildDefaultSettings = (): LauncherSettings => {
  const base = defaultLauncherSettings();
  return { ...base, memory: { allocatedRamMb: computeDefaultRamMb() } };
};

const defaults: LauncherStoreSchema = {
  [STORE_KEY_AUTH]: null,
  [STORE_KEY_LAUNCHER_SETTINGS]: buildDefaultSettings(),
  [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
};

const store = new Store<LauncherStoreSchema>({
  name: 'launcher',
  defaults,
});

type MigrationFn = (settings: LauncherSettings) => LauncherSettings;

// Indexed by the version we're migrating FROM. Add entries as the schema
// evolves; runMigrations applies them in order until CURRENT_SCHEMA_VERSION.
const MIGRATIONS: Record<number, MigrationFn> = {};

const runMigrations = (): void => {
  const stored = store.get(STORE_KEY_SCHEMA_VERSION) ?? 0;
  if (stored === CURRENT_SCHEMA_VERSION) return;
  if (stored > CURRENT_SCHEMA_VERSION) {
    logger.warn(
      `Stored schema version ${stored} is ahead of code ${CURRENT_SCHEMA_VERSION}; leaving as-is.`,
    );
    return;
  }
  let current = store.get(STORE_KEY_LAUNCHER_SETTINGS);
  for (let version = stored; version < CURRENT_SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version];
    // Gap in the chain would silently corrupt user state — abort and let
    // the next release supply the missing step.
    if (!step) {
      throw new Error(`Missing schema migration step from version ${version} to ${version + 1}`);
    }
    logger.info(`Migrating launcher settings ${version} → ${version + 1}`);
    current = step(current);
  }
  store.set(STORE_KEY_LAUNCHER_SETTINGS, normalizeLauncherSettings(current));
  store.set(STORE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
};

runMigrations();

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
