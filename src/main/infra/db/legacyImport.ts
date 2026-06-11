import { existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { scopedLogger } from '@main/infra/logger';
import {
  STORE_KEY_AUTH,
  STORE_KEY_INSTANCE_REGISTRY,
  STORE_KEY_LAST_PLAYED,
  STORE_KEY_LAUNCHER_SETTINGS,
  STORE_KEY_SCHEMA_VERSION,
} from '@shared/constants';
import { InstanceRegistrySchema } from '@shared/contracts/instance';
import { normalizeLauncherSettings } from '@shared/domain/settings';
import type { Db } from './connection';
import {
  readSettings,
  replaceInstanceEntries,
  seedAuthRow,
  setMeta,
  upsertLastPlayed,
  writeSettings,
} from './repos';

const logger = scopedLogger('store');

export const LEGACY_STORE_FILE = 'launcher.json';
export const LEGACY_AUTH_SECRET_FILE = 'auth-session.bin';

const errorMeta = (error: unknown): { message: string } => ({
  message: error instanceof Error ? error.message : String(error),
});

// One-time migration from the previous electron-store layout. Returns true when
// a legacy `launcher.json` was found (and therefore handled), false on a fresh
// install. Idempotent in practice: the caller only invokes it before any
// settings row exists, and on success the legacy files are renamed aside.
export const importLegacyElectronStore = (db: Db, userDataDir: string): boolean => {
  const jsonPath = path.join(userDataDir, LEGACY_STORE_FILE);
  if (!existsSync(jsonPath)) return false;

  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    importSettings(db, raw);
    importSchemaVersion(db, raw);
    importAuth(db, raw, userDataDir);
    importInstances(db, raw);
    importLastPlayed(db, raw);
    logger.info('Imported legacy electron-store data into launcher.db');
  } catch (error) {
    logger.warn('Failed to import legacy electron-store data; starting fresh', errorMeta(error));
    if (!readSettings(db)) writeSettings(db, normalizeLauncherSettings(undefined));
  }

  archiveLegacyFile(jsonPath);
  archiveLegacyFile(path.join(userDataDir, LEGACY_AUTH_SECRET_FILE));
  return true;
};

const importSettings = (db: Db, raw: Record<string, unknown>): void => {
  writeSettings(db, normalizeLauncherSettings(raw[STORE_KEY_LAUNCHER_SETTINGS]));
};

const importSchemaVersion = (db: Db, raw: Record<string, unknown>): void => {
  const stored = raw[STORE_KEY_SCHEMA_VERSION];
  setMeta(db, STORE_KEY_SCHEMA_VERSION, String(typeof stored === 'number' ? stored : 0));
};

// The legacy `auth` value is copied verbatim into account metadata, and the
// encrypted secret blob (if any) from `auth-session.bin` into the BLOB column.
// A plaintext full session has no blob; the store re-splits it on first read.
const importAuth = (db: Db, raw: Record<string, unknown>, userDataDir: string): void => {
  const auth = raw[STORE_KEY_AUTH];
  if (!auth || typeof auth !== 'object') return;
  const binPath = path.join(userDataDir, LEGACY_AUTH_SECRET_FILE);
  const secret = existsSync(binPath) ? readFileSync(binPath) : null;
  seedAuthRow(db, JSON.stringify(auth), secret);
};

const importInstances = (db: Db, raw: Record<string, unknown>): void => {
  const parsed = InstanceRegistrySchema.safeParse(raw[STORE_KEY_INSTANCE_REGISTRY]);
  if (!parsed.success) return;
  replaceInstanceEntries(
    db,
    parsed.data.instances.map((entry) => ({
      id: entry.id,
      name: entry.name,
      dir: entry.dir,
      updatedAt: entry.updatedAt,
    })),
  );
};

const importLastPlayed = (db: Db, raw: Record<string, unknown>): void => {
  const lastPlayed = raw[STORE_KEY_LAST_PLAYED];
  if (!lastPlayed || typeof lastPlayed !== 'object') return;
  for (const [key, value] of Object.entries(lastPlayed)) {
    if (typeof value === 'number') upsertLastPlayed(db, key, value);
  }
};

const archiveLegacyFile = (filePath: string): void => {
  if (!existsSync(filePath)) return;
  try {
    renameSync(filePath, `${filePath}.imported`);
  } catch (error) {
    logger.warn(`Failed to archive legacy file ${path.basename(filePath)}`, errorMeta(error));
  }
};
