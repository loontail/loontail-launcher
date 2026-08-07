import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { applyDbSchema } from './schema';

export type Db = Database.Database;

export const DB_FILE_NAME = 'launcher.db';

let connection: Db | null = null;

// The parent directory is created first because a custom path may not exist. WAL
// keeps reads non-blocking during the store's synchronous writes.
export const openDatabase = (filePath: string): Db => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyDbSchema(db);
  return db;
};

// Lazily-opened process-wide handle, so importing this module triggers no
// filesystem I/O until first use.
export const getDb = (): Db => {
  if (!connection) {
    connection = openDatabase(path.join(app.getPath('userData'), DB_FILE_NAME));
  }
  return connection;
};

// Checkpoint and truncate the WAL before closing so the last synchronous writes
// land in the main file on clean shutdown instead of lingering in `-wal`. A
// checkpoint failure must not block the close; WAL recovers on next open.
export const closeDatabase = (): void => {
  if (!connection) return;
  try {
    connection.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  connection.close();
  connection = null;
};
