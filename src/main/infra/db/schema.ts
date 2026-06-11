import type { Database } from 'better-sqlite3';

// Physical layout version of launcher.db. Distinct from the LauncherSettings
// `schemaVersion` (a logical settings-shape version persisted in the `meta`
// table): this one tracks the table structure itself. Bump it and add a step
// to `LAYOUT_MIGRATIONS` when the columns/tables change incompatibly.
export const DB_LAYOUT_VERSION = 1;

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  allocated_ram_mb  INTEGER NOT NULL,
  clients_folder    TEXT    NOT NULL,
  launch_console    INTEGER NOT NULL,
  launch_fullscreen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_overrides (
  slug TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_account (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  metadata TEXT NOT NULL,
  secret   BLOB
);

CREATE TABLE IF NOT EXISTS instances (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  dir        TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  position   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS last_played (
  catalog_key TEXT    PRIMARY KEY,
  played_at   INTEGER NOT NULL
);
`;

// Indexed by the layout version being migrated FROM. Empty today: version 1 is
// the initial layout. Add a step here (and bump DB_LAYOUT_VERSION) for every
// incompatible table change so existing databases upgrade in place.
const LAYOUT_MIGRATIONS: Record<number, (db: Database) => void> = {};

// Create the tables and advance the physical layout to DB_LAYOUT_VERSION. Runs
// inside a single transaction so a partial upgrade never leaves a half-built
// schema behind. Idempotent: re-running on an up-to-date database is a no-op.
export const applyDbSchema = (db: Database): void => {
  db.exec(CREATE_TABLES);
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= DB_LAYOUT_VERSION) return;
  const upgrade = db.transaction(() => {
    for (let version = current; version < DB_LAYOUT_VERSION; version++) {
      LAYOUT_MIGRATIONS[version]?.(db);
    }
    db.pragma(`user_version = ${DB_LAYOUT_VERSION}`);
  });
  upgrade();
};
