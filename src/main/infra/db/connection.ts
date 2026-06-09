import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { applyDbSchema } from './schema';

export type Db = Database.Database;

export const DB_FILE_NAME = 'launcher.db';

let instance: Db | null = null;

// Open a launcher database at `filePath`, apply pragmas, and ensure the schema
// is current. The parent directory is created first — `userData` exists on a
// normal Electron run, but a custom path may not. WAL keeps reads non-blocking
// during the synchronous writes the store performs; `foreign_keys` is enabled
// for future relational integrity.
export const openDatabase = (filePath: string): Db => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyDbSchema(db);
  return db;
};

// Lazily-opened process-wide handle. The first access resolves the path under
// `userData`, so importing this module triggers no filesystem I/O — unit tests
// can import the store without touching disk until they call into it.
export const getDb = (): Db => {
  if (!instance) {
    instance = openDatabase(path.join(app.getPath('userData'), DB_FILE_NAME));
  }
  return instance;
};

// Close and forget the handle. Production calls this on `before-quit`; tests use
// it to release the file lock between cases before deleting the database file.
export const closeDatabase = (): void => {
  if (!instance) return;
  instance.close();
  instance = null;
};
