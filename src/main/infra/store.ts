import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  AzureClientIdSchema,
  MojangExpiresAtSchema,
  MojangProfileSchema,
  MojangXuidSchema,
  YggdrasilProfileSchema,
} from '@shared/contracts/auth';
import { type LauncherSettings, LauncherSettingsSchema } from '@shared/contracts/settings';
import { defaultLauncherSettings, normalizeLauncherSettings } from '@shared/domain/settings';
import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import { z } from 'zod';

type LauncherStoreSchema = {
  [STORE_KEY_AUTH]: StoredAuthMetadata | null;
  [STORE_KEY_LAUNCHER_SETTINGS]: LauncherSettings;
  [STORE_KEY_SCHEMA_VERSION]: number;
};

const logger = scopedLogger('store');
const AUTH_SECRET_STORAGE_VERSION = 1;
const AUTH_SECRET_FILE_NAME = 'auth-session.bin';
type LinuxSecretBackend = ReturnType<typeof safeStorage.getSelectedStorageBackend>;

const SUPPORTED_LINUX_SECRET_BACKENDS = new Set<LinuxSecretBackend>([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
]);

const StoredYggdrasilAuthMetadataSchema = z.object({
  provider: z.literal('yggdrasil'),
  profile: YggdrasilProfileSchema,
});

const StoredMojangAuthMetadataSchema = z.object({
  provider: z.literal('mojang'),
  expiresAt: MojangExpiresAtSchema,
  clientId: AzureClientIdSchema,
  xuid: MojangXuidSchema,
  profile: MojangProfileSchema,
});

const StoredAuthMetadataSchema = z.discriminatedUnion('provider', [
  StoredYggdrasilAuthMetadataSchema,
  StoredMojangAuthMetadataSchema,
]);

type StoredAuthMetadata = z.infer<typeof StoredAuthMetadataSchema>;

const YggdrasilAuthSecretSchema = z.object({
  version: z.literal(AUTH_SECRET_STORAGE_VERSION),
  provider: z.literal('yggdrasil'),
  accessToken: z.string().min(1),
  clientToken: z.string().min(1),
});

const MojangAuthSecretSchema = z.object({
  version: z.literal(AUTH_SECRET_STORAGE_VERSION),
  provider: z.literal('mojang'),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

const AuthSecretSchema = z.discriminatedUnion('provider', [
  YggdrasilAuthSecretSchema,
  MojangAuthSecretSchema,
]);

type AuthSecret = z.infer<typeof AuthSecretSchema>;

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
// 0 → 1 is an identity step: version-0 settings are structurally identical to
// version 1, so the bump only stamps the version. Without it any pre-versioning
// store (schemaVersion 0) would throw at module load and crash the main process.
const MIGRATIONS: Record<number, MigrationFn> = {
  0: (settings) => settings,
};

// Apply the migration steps from `fromVersion` up to `toVersion`, in order.
// A gap in the chain would silently corrupt user state, so a missing step
// throws and lets the next release supply it. Pure: no store access, so the
// gap-throw and ordering are unit-testable in isolation.
export const applySettingsMigrations = (
  settings: LauncherSettings,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, MigrationFn> = MIGRATIONS,
): LauncherSettings => {
  let current = settings;
  for (let version = fromVersion; version < toVersion; version++) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`Missing schema migration step from version ${version} to ${version + 1}`);
    }
    logger.info(`Migrating launcher settings ${version} → ${version + 1}`);
    current = step(current);
  }
  return current;
};

const runMigrations = (): void => {
  const stored = store.get(STORE_KEY_SCHEMA_VERSION) ?? 0;
  if (stored === CURRENT_SCHEMA_VERSION) return;
  if (stored > CURRENT_SCHEMA_VERSION) {
    logger.warn(
      `Stored schema version ${stored} is ahead of code ${CURRENT_SCHEMA_VERSION}; leaving as-is.`,
    );
    return;
  }
  const migrated = applySettingsMigrations(
    store.get(STORE_KEY_LAUNCHER_SETTINGS),
    stored,
    CURRENT_SCHEMA_VERSION,
  );
  store.set(STORE_KEY_LAUNCHER_SETTINGS, normalizeLauncherSettings(migrated));
  store.set(STORE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
};

runMigrations();

const secureStorageFailure = (error: unknown): { message: string } => ({
  message: error instanceof Error ? error.message : 'Unknown secure storage error',
});

const authSecretPath = (): string => path.join(app.getPath('userData'), AUTH_SECRET_FILE_NAME);

const assertSecureStorageAvailable = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure auth storage is unavailable');
  }
  if (process.platform !== 'linux') return;
  const backend = safeStorage.getSelectedStorageBackend();
  if (!SUPPORTED_LINUX_SECRET_BACKENDS.has(backend)) {
    throw new Error(`Secure auth storage is unavailable for Linux backend ${backend}`);
  }
};

const metadataFromSession = (session: AuthSession): StoredAuthMetadata => {
  if (session.provider === 'yggdrasil') {
    return { provider: 'yggdrasil', profile: session.profile };
  }
  return {
    provider: 'mojang',
    expiresAt: session.expiresAt,
    clientId: session.clientId,
    xuid: session.xuid,
    profile: session.profile,
  };
};

const secretFromSession = (session: AuthSession): AuthSecret => {
  if (session.provider === 'yggdrasil') {
    return {
      version: AUTH_SECRET_STORAGE_VERSION,
      provider: 'yggdrasil',
      accessToken: session.accessToken,
      clientToken: session.clientToken,
    };
  }
  return {
    version: AUTH_SECRET_STORAGE_VERSION,
    provider: 'mojang',
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
};

const hydrateSession = (metadata: StoredAuthMetadata, secret: AuthSecret): unknown => {
  if (metadata.provider === 'yggdrasil') {
    if (secret.provider !== 'yggdrasil') {
      throw new Error('Stored auth secret provider does not match account metadata');
    }
    return {
      ...metadata,
      accessToken: secret.accessToken,
      clientToken: secret.clientToken,
    };
  }
  if (secret.provider !== 'mojang') {
    throw new Error('Stored auth secret provider does not match account metadata');
  }
  return {
    ...metadata,
    accessToken: secret.accessToken,
    refreshToken: secret.refreshToken,
  };
};

const writeAuthSecret = (secret: AuthSecret): void => {
  assertSecureStorageAvailable();
  const filePath = authSecretPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(secret));
  writeFileSync(filePath, encrypted);
};

const readAuthSecret = (): AuthSecret => {
  assertSecureStorageAvailable();
  const filePath = authSecretPath();
  if (!existsSync(filePath)) {
    throw new Error('Stored auth secret is missing');
  }
  const decrypted = safeStorage.decryptString(readFileSync(filePath));
  const parsed = AuthSecretSchema.safeParse(JSON.parse(decrypted) as unknown);
  if (!parsed.success) {
    throw new Error('Stored auth secret failed validation');
  }
  return parsed.data;
};

const clearAuthSecret = (): void => {
  try {
    rmSync(authSecretPath(), { force: true });
  } catch (error) {
    logger.warn('Failed to remove stored auth secret', secureStorageFailure(error));
  }
};

// Drop legacy sessions whose `provider` value is no longer recognised by the
// current discriminated union — old strapi-JWT sessions (`provider:'strapi'`)
// and the very-old pre-tagged shape (`{jwt, user}` with no provider) both
// fall here. Idempotent — `null` and already-valid sessions pass through.
const purgeLegacyAuth = (): void => {
  const raw = store.get(STORE_KEY_AUTH) as unknown;
  if (raw === null || raw === undefined) return;
  if (StoredAuthMetadataSchema.safeParse(raw).success) return;
  if (AuthSessionSchema.safeParse(raw).success) return;
  logger.warn('Dropping legacy auth session from store; user must sign in again');
  store.set(STORE_KEY_AUTH, null);
  clearAuthSecret();
};

purgeLegacyAuth();

const migrateLegacyAuthSession = (session: AuthSession): AuthSession | null => {
  try {
    setStoredAuth(session);
    logger.info('Migrated auth session secrets to secure storage');
    return session;
  } catch (error) {
    logger.warn(
      'Failed to migrate auth session secrets to secure storage; forcing a fresh sign-in',
      secureStorageFailure(error),
    );
    clearStoredAuth();
    return null;
  }
};

export const getStoredAuth = (): AuthSession | null => {
  const raw = store.get(STORE_KEY_AUTH) as unknown;
  if (raw === null || raw === undefined) return null;
  const legacySession = AuthSessionSchema.safeParse(raw);
  if (legacySession.success) return migrateLegacyAuthSession(legacySession.data);

  const metadata = StoredAuthMetadataSchema.safeParse(raw);
  if (!metadata.success) {
    logger.warn('Stored auth session failed validation; forcing a fresh sign-in');
    clearStoredAuth();
    return null;
  }

  try {
    const secret = readAuthSecret();
    const hydrated = hydrateSession(metadata.data, secret);
    const parsed = AuthSessionSchema.safeParse(hydrated);
    if (parsed.success) return parsed.data;
    throw new Error('Stored auth session failed validation after secure-storage rehydration');
  } catch (error) {
    logger.warn(
      'Stored auth secret could not be read; forcing a fresh sign-in',
      secureStorageFailure(error),
    );
    clearStoredAuth();
    return null;
  }
};

export const migrateStoredAuthSecrets = (): void => {
  getStoredAuth();
};

export const setStoredAuth = (session: AuthSession | null): void => {
  if (session === null) {
    clearStoredAuth();
    return;
  }
  try {
    writeAuthSecret(secretFromSession(session));
    store.set(STORE_KEY_AUTH, metadataFromSession(session));
  } catch (error) {
    clearStoredAuth();
    throw new Error('Failed to persist auth session securely', { cause: error });
  }
};

export const clearStoredAuth = (): void => {
  store.set(STORE_KEY_AUTH, null);
  clearAuthSecret();
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
