import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpUserData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'mc-launcher-conn-test-'));
});

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
}));

import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DB_FILE_NAME, closeDatabase, getDb } from '@main/infra/db/connection';

// Exercises the real better-sqlite3 binding under the Node ABI (vitest), so a
// failure here also surfaces a missing/mismatched native build.

const dbFile = path.join(tmpUserData, DB_FILE_NAME);
const walFile = `${dbFile}-wal`;

beforeEach(() => {
  closeDatabase();
  for (const file of [dbFile, walFile, `${dbFile}-shm`]) {
    if (existsSync(file)) rmSync(file);
  }
});

afterAll(() => {
  closeDatabase();
  rmSync(tmpUserData, { recursive: true, force: true });
});

describe('closeDatabase WAL checkpoint', () => {
  it('checkpoints and truncates the WAL before closing so writes land in the main file', () => {
    const db = getDb();
    // A synchronous write (mirrors settings/last-played) lands in the WAL first.
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('probe', 'value');

    expect(existsSync(walFile)).toBe(true);
    expect(statSync(walFile).size).toBeGreaterThan(0);

    closeDatabase();

    // TRUNCATE checkpoint shrinks the WAL to zero (the file may persist empty).
    if (existsSync(walFile)) {
      expect(statSync(walFile).size).toBe(0);
    }

    // The committed write survives a fresh open from the main database file.
    const reopened = getDb();
    const row = reopened.prepare('SELECT value FROM meta WHERE key = ?').get('probe') as
      | { value: string }
      | undefined;
    expect(row?.value).toBe('value');
  });
});
