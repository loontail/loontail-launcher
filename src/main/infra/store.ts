import { scopedLogger } from '@main/infra/logger';
import { computeDefaultRamMb } from '@main/infra/system';
import { CURRENT_SCHEMA_VERSION, STORE_KEY_SCHEMA_VERSION } from '@shared/constants';
import {
  type AuthSession,
  AuthSessionSchema,
  AzureClientIdSchema,
  MojangExpiresAtSchema,
  MojangProfileSchema,
  MojangXuidSchema,
  YggdrasilProfileSchema,
} from '@shared/contracts/auth';
import {
  INSTANCE_REGISTRY_SCHEMA_VERSION,
  type LocalBuildRegistry,
  LocalBuildRegistrySchema,
} from '@shared/contracts/localBuild';
import { type LauncherSettings, LauncherSettingsSchema } from '@shared/contracts/settings';
import {
  defaultLauncherSettings,
  migrateLastPlayedKeys,
  normalizeLauncherSettings,
} from '@shared/domain/settings';
import { app, safeStorage } from 'electron';
import { z } from 'zod';
import { closeDatabase as closeDb, type Db, getDb } from './db/connection';
import { importLegacyElectronStore } from './db/legacyImport';
import {
  deleteAuthRow,
  getMeta,
  readAuthRow,
  readInstanceEntries,
  readLastPlayed,
  readSettings,
  replaceInstanceEntries,
  setMeta,
  upsertLastPlayed,
  writeAuthRow,
  writeSettings,
} from './db/repos';

// Wrapped (not re-exported) so the in-memory bearer cache cannot outlive the
// database it was read from.
export const closeDatabase = (): void => {
  invalidateApiSessionCache();
  closeDb();
};

const logger = scopedLogger('store');
// A blob without the session token fails validation and forces a fresh sign-in,
// which is correct: such a session has no API bearer.
const AUTH_SECRET_STORAGE_VERSION = 2;
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
  // The API bearer, stored encrypted next to the in-game Yggdrasil pair so a
  // single decrypt yields everything a session needs.
  sessionToken: z.string().min(1),
  // Epoch ms the server expires the bearer at. Optional on purpose: blobs
  // written before expiry tracking must keep working, and a missing value means
  // "unknown" — the caller then refreshes once instead of assuming freshness.
  sessionExpiresAt: z.number().int().positive().nullable().optional(),
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

// The universal API bearer plus the moment the server stops accepting it.
// `expiresAt` is null when unknown (a session stored before expiry tracking) —
// callers treat that as "refresh once" rather than as "never expires".
export type StoredApiSession = {
  readonly token: string;
  readonly expiresAt: number | null;
};

const emptyLocalBuildRegistry = (): LocalBuildRegistry => ({
  schema: INSTANCE_REGISTRY_SCHEMA_VERSION,
  instances: [],
});

const buildDefaultSettings = (): LauncherSettings => {
  const base = defaultLauncherSettings();
  return { ...base, memory: { allocatedRamMb: computeDefaultRamMb() } };
};

type MigrationFn = (settings: LauncherSettings) => LauncherSettings;

// Indexed by the version migrated FROM. 0 → 1 is an identity step: version-0
// settings are structurally identical to version 1, so the bump only stamps.
const MIGRATIONS: Record<number, MigrationFn> = {
  0: (settings) => settings,
};

// A gap in the migration chain would silently corrupt user state, so a missing
// step throws and lets the next release supply it.
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

const readSchemaVersion = (db: Db): number => {
  const raw = getMeta(db, STORE_KEY_SCHEMA_VERSION);
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runMigrations = (db: Db): void => {
  const stored = readSchemaVersion(db);
  if (stored === CURRENT_SCHEMA_VERSION) return;
  if (stored > CURRENT_SCHEMA_VERSION) {
    logger.warn(
      `Stored schema version ${stored} is ahead of code ${CURRENT_SCHEMA_VERSION}; leaving as-is.`,
    );
    return;
  }
  const migrated = applySettingsMigrations(
    getStoredLauncherSettings(),
    stored,
    CURRENT_SCHEMA_VERSION,
  );
  setStoredLauncherSettings(migrated);
  setMeta(db, STORE_KEY_SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
};

const seedDefaults = (db: Db): void => {
  writeSettings(db, buildDefaultSettings());
  setMeta(db, STORE_KEY_SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
};

// Explicit store bootstrap so importing this module (e.g. from a unit test)
// triggers no store I/O until invoked. Called once before any service is created.
export const initStore = (): void => {
  const db = getDb();
  if (!readSettings(db)) {
    const imported = importLegacyElectronStore(db, app.getPath('userData'));
    if (!imported) seedDefaults(db);
  }
  runMigrations(db);
  purgeLegacyAuth(db);
  // The import/purge above can rewrite or drop the auth row behind the cache.
  invalidateApiSessionCache();
};

const secureStorageFailure = (error: unknown): { message: string } => ({
  message: error instanceof Error ? error.message : 'Unknown secure storage error',
});

// TRANSIENT secret-store unavailability (keyring/DBus hiccup, not-yet-ready
// backend) that must NOT destroy a still-valid session: callers fail soft (keep
// the row) and retry. Distinct from a present-but-corrupt blob, which IS deleted.
class SecureStorageUnavailableError extends Error {
  readonly transient = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'SecureStorageUnavailableError';
  }
}

const isTransientSecureStorageError = (error: unknown): boolean =>
  error instanceof SecureStorageUnavailableError;

const assertSecureStorageAvailable = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecureStorageUnavailableError('Secure auth storage is unavailable');
  }
  if (process.platform !== 'linux') return;
  const backend = safeStorage.getSelectedStorageBackend();
  if (!SUPPORTED_LINUX_SECRET_BACKENDS.has(backend)) {
    throw new SecureStorageUnavailableError(
      `Secure auth storage is unavailable for Linux backend ${backend}`,
    );
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

const secretFromSession = (
  session: AuthSession,
  apiSession: StoredApiSession | undefined,
): AuthSecret => {
  if (session.provider === 'yggdrasil') {
    if (!apiSession) {
      // A Yggdrasil session without its API bearer is unusable; refuse to persist
      // a half-session rather than store one that 401s on every call.
      throw new Error('Yggdrasil session requires a Loontail session token');
    }
    return {
      version: AUTH_SECRET_STORAGE_VERSION,
      provider: 'yggdrasil',
      accessToken: session.accessToken,
      clientToken: session.clientToken,
      sessionToken: apiSession.token,
      sessionExpiresAt: apiSession.expiresAt,
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
    return { ...metadata, accessToken: secret.accessToken, clientToken: secret.clientToken };
  }
  if (secret.provider !== 'mojang') {
    throw new Error('Stored auth secret provider does not match account metadata');
  }
  return { ...metadata, accessToken: secret.accessToken, refreshToken: secret.refreshToken };
};

// Token material is never written in plaintext: it lives only inside this
// `safeStorage`-encrypted blob (Windows DPAPI / macOS Keychain / Linux
// libsecret|KWallet).
const decryptAuthSecret = (blob: Buffer | null): AuthSecret => {
  assertSecureStorageAvailable();
  if (!blob || blob.length === 0) {
    throw new Error('Stored auth secret is missing');
  }
  const parsed = AuthSecretSchema.safeParse(JSON.parse(safeStorage.decryptString(blob)) as unknown);
  if (!parsed.success) {
    throw new Error('Stored auth secret failed validation');
  }
  return parsed.data;
};

// Only Mojang legacy sessions can be migrated in place: a legacy Yggdrasil
// session has no session token, so `setStoredAuth` rejects it and it falls
// through to a clean re-login.
const migrateLegacyAuthSession = (session: AuthSession): AuthSession | null => {
  try {
    setStoredAuth(session);
    logger.info('Migrated auth session secrets to secure storage');
    return session;
  } catch (error) {
    if (isTransientSecureStorageError(error)) {
      // Leave the legacy row in place so the migration retries on the next read
      // instead of dropping a still-valid session.
      logger.warn(
        'Secure auth storage is temporarily unavailable; deferring legacy session migration',
        secureStorageFailure(error),
      );
      return null;
    }
    logger.warn(
      'Failed to migrate auth session secrets to secure storage; forcing a fresh sign-in',
      secureStorageFailure(error),
    );
    clearStoredAuth();
    return null;
  }
};

const parseStoredMetadata = (metadata: string): unknown | null => {
  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return null;
  }
};

// Drop legacy sessions whose `provider` value is no longer recognised by the
// current discriminated union. Idempotent: an absent row and already-valid
// metadata pass through untouched.
const purgeLegacyAuth = (db: Db): void => {
  const row = readAuthRow(db);
  if (!row) return;
  const raw = parseStoredMetadata(row.metadata);
  if (raw === null) {
    deleteAuthRow(db);
    return;
  }
  if (StoredAuthMetadataSchema.safeParse(raw).success) return;
  if (AuthSessionSchema.safeParse(raw).success) return;
  logger.warn('Dropping legacy auth session from store; user must sign in again');
  deleteAuthRow(db);
};

// Reading also migrates: a legacy session stored without the secret/metadata
// split is rewritten in place via `migrateLegacyAuthSession`.
export const getStoredAuth = (): AuthSession | null => {
  const row = readAuthRow(getDb());
  if (!row) return null;

  const raw = parseStoredMetadata(row.metadata);
  if (raw === null) {
    logger.warn('Stored auth metadata could not be parsed; forcing a fresh sign-in');
    clearStoredAuth();
    return null;
  }

  const legacySession = AuthSessionSchema.safeParse(raw);
  if (legacySession.success) return migrateLegacyAuthSession(legacySession.data);

  const metadata = StoredAuthMetadataSchema.safeParse(raw);
  if (!metadata.success) {
    logger.warn('Stored auth session failed validation; forcing a fresh sign-in');
    clearStoredAuth();
    return null;
  }

  try {
    const hydrated = hydrateSession(metadata.data, decryptAuthSecret(row.secret));
    const parsed = AuthSessionSchema.safeParse(hydrated);
    if (parsed.success) return parsed.data;
    throw new Error('Stored auth session failed validation after secure-storage rehydration');
  } catch (error) {
    if (isTransientSecureStorageError(error)) {
      // Keep the row so the next read can recover the still-valid session
      // instead of forcing a re-login.
      logger.warn(
        'Secure auth storage is temporarily unavailable; keeping the stored session',
        secureStorageFailure(error),
      );
      return null;
    }
    logger.warn(
      'Stored auth secret could not be read; forcing a fresh sign-in',
      secureStorageFailure(error),
    );
    clearStoredAuth();
    return null;
  }
};

// Triggers the legacy-session migration baked into `getStoredAuth` at a
// deterministic point during init rather than on whichever consumer reads first.
export const runAuthStoreMigrationIfNeeded = (): void => {
  getStoredAuth();
};

// The API bearer is read on the hot path — once per bundle file request and per
// media fetch — and every read cost a sqlite hit plus a synchronous
// safeStorage/DPAPI decrypt. Cache the already-in-memory bearer and invalidate
// beside the only two writers of the row (`setStoredAuth`/`clearStoredAuth`), so
// a rotated single-use token can never be served stale. `undefined` = not yet
// read, `null` = read and genuinely absent (a Mojang session has no bearer).
let apiSessionCache: StoredApiSession | null | undefined;

const invalidateApiSessionCache = (): void => {
  apiSessionCache = undefined;
};

const rememberApiSession = (value: StoredApiSession | null): StoredApiSession | null => {
  apiSessionCache = value;
  return value;
};

// `apiSession` carries the API bearer: mandatory for Yggdrasil sessions, ignored
// for Mojang (which has none).
export const setStoredAuth = (session: AuthSession | null, apiSession?: StoredApiSession): void => {
  if (session === null) {
    clearStoredAuth();
    return;
  }
  invalidateApiSessionCache();
  try {
    assertSecureStorageAvailable();
    const encrypted = safeStorage.encryptString(
      JSON.stringify(secretFromSession(session, apiSession)),
    );
    writeAuthRow(getDb(), JSON.stringify(metadataFromSession(session)), encrypted);
  } catch (error) {
    if (isTransientSecureStorageError(error)) {
      // Don't wipe an existing row over a transient outage; surface the failure
      // so the caller can retry once secure storage is back.
      throw error;
    }
    clearStoredAuth();
    throw new Error('Failed to persist auth session securely', { cause: error });
  }
};

// The API bearer for the stored session with its expiry, or null when none is
// stored (Mojang has no token) or decrypt/validation fails — callers then fall
// back to re-login.
export const getStoredApiSession = (): StoredApiSession | null => {
  if (apiSessionCache !== undefined) return apiSessionCache;
  const row = readAuthRow(getDb());
  if (!row) return rememberApiSession(null);
  const raw = parseStoredMetadata(row.metadata);
  if (raw === null) return rememberApiSession(null);
  const metadata = StoredAuthMetadataSchema.safeParse(raw);
  if (!metadata.success || metadata.data.provider !== 'yggdrasil') return rememberApiSession(null);
  try {
    const secret = decryptAuthSecret(row.secret);
    if (secret.provider !== 'yggdrasil') return rememberApiSession(null);
    return rememberApiSession({
      token: secret.sessionToken,
      expiresAt: secret.sessionExpiresAt ?? null,
    });
  } catch {
    // Not cached: a decrypt failure can be a transient secure-storage outage,
    // and caching it would keep a still-valid session unreadable until a write.
    return null;
  }
};

export const getStoredSessionToken = (): string | null => getStoredApiSession()?.token ?? null;

export const clearStoredAuth = (): void => {
  invalidateApiSessionCache();
  deleteAuthRow(getDb());
};

export const getStoredLauncherSettings = (): LauncherSettings => {
  const raw = readSettings(getDb());
  if (raw === null) return buildDefaultSettings();
  const parsed = LauncherSettingsSchema.safeParse(raw);
  if (parsed.success) return normalizeLauncherSettings(parsed.data);
  logger.warn('Stored launcher settings failed validation; falling back to defaults', parsed.error);
  return buildDefaultSettings();
};

export const setStoredLauncherSettings = (settings: LauncherSettings): LauncherSettings => {
  const normalized = normalizeLauncherSettings(settings);
  writeSettings(getDb(), normalized);
  return normalized;
};

// The local-build index. A malformed value degrades to an empty registry; the
// local-builds service self-heals it from the on-disk build manifests.
export const getStoredLocalBuildRegistry = (): LocalBuildRegistry => {
  const registry = {
    schema: INSTANCE_REGISTRY_SCHEMA_VERSION,
    instances: readInstanceEntries(getDb()),
  };
  const parsed = LocalBuildRegistrySchema.safeParse(registry);
  if (parsed.success) return parsed.data;
  logger.warn('Stored local-build registry failed validation; falling back to empty');
  return emptyLocalBuildRegistry();
};

export const setStoredLocalBuildRegistry = (registry: LocalBuildRegistry): LocalBuildRegistry => {
  replaceInstanceEntries(getDb(), registry.instances);
  return registry;
};

// Keyed by CatalogKey so the renderer can match the map against the catalog. A
// stale key (build later deleted) is harmless: the selector ignores unmatched keys.
export const recordPlayed = (key: string): void => {
  upsertLastPlayed(getDb(), key, Date.now());
};

// Rehydrate legacy bare-keyed entries to CatalogKey form on read so Home recents
// (matched by `item.key`) still line up after an upgrade.
export const getLastPlayed = (): Record<string, number> =>
  migrateLastPlayedKeys(readLastPlayed(getDb()));
