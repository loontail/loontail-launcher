import { scopedLogger } from '@main/infra/logger';
import { computeDefaultRamMb } from '@main/infra/system';
import {
  CURRENT_SCHEMA_VERSION,
  STORE_KEY_AUTH,
  STORE_KEY_LAUNCHER_SETTINGS,
  STORE_KEY_SCHEMA_VERSION,
} from '@shared/constants';
import {
  type AuthSession,
  AuthSessionSchema,
  type StrapiSession,
  type StrapiUser,
} from '@shared/contracts/auth';
import { type LauncherSettings, LauncherSettingsSchema } from '@shared/contracts/settings';
import { defaultLauncherSettings, normalizeLauncherSettings } from '@shared/domain/settings';
import Store from 'electron-store';

type LauncherStoreSchema = {
  [STORE_KEY_AUTH]: AuthSession | null;
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

// One-shot migration of the auth blob from the pre-multi-provider shape
// (`{ jwt, user }`) to a provider-tagged `AuthSession`. Idempotent — leaves
// already-tagged sessions and `null` alone.
type LegacyAuth = { jwt: string; user: StrapiUser };

const isLegacyAuth = (value: unknown): value is LegacyAuth => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    !('provider' in candidate) &&
    typeof candidate.jwt === 'string' &&
    typeof candidate.user === 'object' &&
    candidate.user !== null
  );
};

const migrateAuth = (): void => {
  const raw = store.get(STORE_KEY_AUTH) as unknown;
  if (raw === null) return;
  if (isLegacyAuth(raw)) {
    const migrated: StrapiSession = {
      provider: 'strapi',
      jwt: raw.jwt,
      user: raw.user,
    };
    store.set(STORE_KEY_AUTH, migrated);
    logger.info('Migrated stored auth to provider-tagged session');
  }
};

migrateAuth();

export const getStoredAuth = (): AuthSession | null => {
  const raw = store.get(STORE_KEY_AUTH);
  if (raw === null || raw === undefined) return null;
  const parsed = AuthSessionSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.warn('Stored auth session failed validation; forcing a fresh sign-in', parsed.error);
  return null;
};

export const setStoredAuth = (session: AuthSession | null): void => {
  store.set(STORE_KEY_AUTH, session);
};

export const clearStoredAuth = (): void => {
  store.set(STORE_KEY_AUTH, null);
};

export const getStoredLauncherSettings = (): LauncherSettings => {
  const raw = store.get(STORE_KEY_LAUNCHER_SETTINGS);
  const parsed = LauncherSettingsSchema.safeParse(raw);
  if (parsed.success) return normalizeLauncherSettings(parsed.data);
  logger.warn('Stored launcher settings failed validation; falling back to defaults', parsed.error);
  return buildDefaultSettings();
};

export const setStoredLauncherSettings = (settings: LauncherSettings): LauncherSettings => {
  const normalized = normalizeLauncherSettings(settings);
  store.set(STORE_KEY_LAUNCHER_SETTINGS, normalized);
  return normalized;
};
