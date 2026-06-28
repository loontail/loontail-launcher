import type { LauncherSettings } from '@shared/contracts/settings';
import type { Db } from './connection';

// Raw persistence layer: SQL ↔ plain JS, no validation or domain logic (the
// store facade owns those). The database handle is passed explicitly so the
// facade controls the single connection and tests can pass their own.

export const getMeta = (db: Db, key: string): string | null => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

export const setMeta = (db: Db, key: string, value: string): void => {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
};

type SettingsRow = {
  allocated_ram_mb: number;
  clients_folder: string;
  launch_console: number;
  launch_fullscreen: number;
};

// Returns `null` when no settings row exists yet so the facade falls back to
// defaults. An unparseable override row degrades to `{}` rather than throwing.
export const readSettings = (db: Db): Record<string, unknown> | null => {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow | undefined;
  if (!row) return null;

  const overrideRows = db.prepare('SELECT slug, data FROM client_overrides').all() as Array<{
    slug: string;
    data: string;
  }>;
  const clients: Record<string, unknown> = {};
  for (const { slug, data } of overrideRows) {
    clients[slug] = parseJsonObject(data);
  }

  return {
    memory: { allocatedRamMb: row.allocated_ram_mb },
    storage: { clientsFolder: row.clients_folder },
    launch: { console: row.launch_console !== 0, fullscreen: row.launch_fullscreen !== 0 },
    clients,
  };
};

const parseJsonObject = (raw: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

// Replace the singleton settings row and all client overrides in one transaction.
export const writeSettings = (db: Db, settings: LauncherSettings): void => {
  const tx = db.transaction((value: LauncherSettings) => {
    db.prepare(
      `INSERT INTO settings (id, allocated_ram_mb, clients_folder, launch_console, launch_fullscreen)
       VALUES (1, @ram, @folder, @console, @fullscreen)
       ON CONFLICT(id) DO UPDATE SET
         allocated_ram_mb  = excluded.allocated_ram_mb,
         clients_folder    = excluded.clients_folder,
         launch_console    = excluded.launch_console,
         launch_fullscreen = excluded.launch_fullscreen`,
    ).run({
      ram: value.memory.allocatedRamMb,
      folder: value.storage.clientsFolder,
      console: value.launch.console ? 1 : 0,
      fullscreen: value.launch.fullscreen ? 1 : 0,
    });

    db.prepare('DELETE FROM client_overrides').run();
    const insert = db.prepare('INSERT INTO client_overrides (slug, data) VALUES (?, ?)');
    for (const [slug, override] of Object.entries(value.clients)) {
      insert.run(slug, JSON.stringify(override));
    }
  });
  tx(settings);
};

export type AuthRow = { metadata: string; secret: Buffer | null };

export const readAuthRow = (db: Db): AuthRow | null => {
  const row = db.prepare('SELECT metadata, secret FROM auth_account WHERE id = 1').get() as
    | AuthRow
    | undefined;
  return row ?? null;
};

// `secret` is null only on the legacy-import path; live writes always supply an
// encrypted secret.
export const writeAuthRow = (db: Db, metadata: string, secret: Buffer | null): void => {
  db.prepare(
    `INSERT INTO auth_account (id, metadata, secret) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata, secret = excluded.secret`,
  ).run(metadata, secret);
};

export const deleteAuthRow = (db: Db): void => {
  db.prepare('DELETE FROM auth_account WHERE id = 1').run();
};

export type InstanceRow = { id: string; name: string; dir: string; updatedAt: string };

export const readInstanceEntries = (db: Db): InstanceRow[] =>
  db
    .prepare('SELECT id, name, dir, updated_at AS updatedAt FROM instances ORDER BY position')
    .all() as InstanceRow[];

export const replaceInstanceEntries = (db: Db, entries: InstanceRow[]): void => {
  const tx = db.transaction((rows: InstanceRow[]) => {
    db.prepare('DELETE FROM instances').run();
    const insert = db.prepare(
      'INSERT INTO instances (id, name, dir, updated_at, position) VALUES (?, ?, ?, ?, ?)',
    );
    rows.forEach((entry, position) => {
      insert.run(entry.id, entry.name, entry.dir, entry.updatedAt, position);
    });
  });
  tx(entries);
};

export const readLastPlayed = (db: Db): Record<string, number> => {
  const rows = db
    .prepare('SELECT catalog_key AS key, played_at AS playedAt FROM last_played')
    .all() as Array<{
    key: string;
    playedAt: number;
  }>;
  const out: Record<string, number> = {};
  for (const { key, playedAt } of rows) out[key] = playedAt;
  return out;
};

export const upsertLastPlayed = (db: Db, key: string, playedAt: number): void => {
  db.prepare(
    `INSERT INTO last_played (catalog_key, played_at) VALUES (?, ?)
     ON CONFLICT(catalog_key) DO UPDATE SET played_at = excluded.played_at`,
  ).run(key, playedAt);
};
