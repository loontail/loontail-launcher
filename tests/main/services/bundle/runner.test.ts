import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SyncPlan } from '@main/services/bundle/plan';
import { type EmitProgress, runSyncPhases } from '@main/services/bundle/runner';
import { createSyncTask, markPaused, markRunning } from '@main/services/bundle/syncState';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SLUG = asCatalogKey('official:delete-client');
const OLD_ONE_PATH = 'mods/old-one.jar';
const OLD_TWO_PATH = 'mods/old-two.jar';

const exists = async (absolutePath: string): Promise<boolean> => {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const deleteOnlyPlan = (toDelete: string[]): SyncPlan => ({
  toDownload: [],
  toUpdate: [],
  toDelete,
  toSkip: [],
  bundleOwnedRelativePaths: new Set<string>(),
  bytesTotal: 0,
});

const noopEmit: EmitProgress = () => undefined;

describe('runSyncPhases delete pause handling', () => {
  let clientFolder: string;

  beforeEach(async () => {
    clientFolder = await fs.mkdtemp(path.join(tmpdir(), 'bundle-runner-'));
    await fs.mkdir(path.join(clientFolder, 'mods'), { recursive: true });
    await fs.writeFile(path.join(clientFolder, OLD_ONE_PATH), 'old-one');
    await fs.writeFile(path.join(clientFolder, OLD_TWO_PATH), 'old-two');
  });

  afterEach(async () => {
    await fs.rm(clientFolder, { recursive: true, force: true });
  });

  it('keeps remaining deletes pending when paused during the delete phase', async () => {
    const task = createSyncTask(SLUG, clientFolder);
    task.plan = deleteOnlyPlan([OLD_ONE_PATH, OLD_TWO_PATH]);
    task.pendingDeletes = [...task.plan.toDelete];
    task.totalFiles = task.pendingDeletes.length;

    let deleteEmits = 0;
    const pauseAfterFirstDelete: EmitProgress = (_slug, status) => {
      if (status !== BundleSyncStatuses.DELETING) return;
      deleteEmits += 1;
      if (deleteEmits === 1) {
        task.lastEmittedAt = 0;
        return;
      }
      markPaused(task);
    };

    await expect(runSyncPhases(task, pauseAfterFirstDelete)).resolves.toEqual({
      outcome: 'paused',
      deletedAny: true,
    });

    expect(task.pendingDeletes).toEqual([OLD_TWO_PATH]);
    expect(task.processedFiles).toBe(1);
    expect(await exists(path.join(clientFolder, OLD_ONE_PATH))).toBe(false);
    expect(await exists(path.join(clientFolder, OLD_TWO_PATH))).toBe(true);

    markRunning(task);

    await expect(runSyncPhases(task, noopEmit)).resolves.toEqual({
      outcome: 'completed',
      deletedAny: true,
    });

    expect(task.pendingDeletes).toEqual([]);
    expect(task.processedFiles).toBe(2);
    expect(await exists(path.join(clientFolder, OLD_TWO_PATH))).toBe(false);
  });

  it('flags deletedAny when every target is already gone (ENOENT) so heal still runs', async () => {
    await fs.rm(path.join(clientFolder, OLD_ONE_PATH));
    await fs.rm(path.join(clientFolder, OLD_TWO_PATH));

    const task = createSyncTask(SLUG, clientFolder);
    task.plan = deleteOnlyPlan([OLD_ONE_PATH, OLD_TWO_PATH]);
    task.pendingDeletes = [...task.plan.toDelete];
    task.totalFiles = task.pendingDeletes.length;

    await expect(runSyncPhases(task, noopEmit)).resolves.toEqual({
      outcome: 'completed',
      deletedAny: true,
    });
    expect(task.pendingDeletes).toEqual([]);
    expect(task.processedFiles).toBe(2);
  });

  it('counts processedFiles for a mix of one existing and one missing target', async () => {
    await fs.rm(path.join(clientFolder, OLD_TWO_PATH));

    const task = createSyncTask(SLUG, clientFolder);
    task.plan = deleteOnlyPlan([OLD_ONE_PATH, OLD_TWO_PATH]);
    task.pendingDeletes = [...task.plan.toDelete];
    task.totalFiles = task.pendingDeletes.length;

    await expect(runSyncPhases(task, noopEmit)).resolves.toEqual({
      outcome: 'completed',
      deletedAny: true,
    });
    expect(task.processedFiles).toBe(2);
    expect(await exists(path.join(clientFolder, OLD_ONE_PATH))).toBe(false);
  });
});
