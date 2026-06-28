import { setMaxListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ downloadEntry: vi.fn() }));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/bundle/download', () => ({ downloadEntry: mocks.downloadEntry }));

import { BUNDLE_DOWNLOAD_CONCURRENCY } from '@main/constants/bundle';
import type { SyncPlan } from '@main/services/bundle/plan';
import { type EmitProgress, runSyncPhases } from '@main/services/bundle/runner';
import { createSyncTask } from '@main/services/bundle/syncState';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';

const SLUG = asCatalogKey('official:abort-client');
const noopEmit: EmitProgress = () => undefined;

const downloadPlan = (count: number): SyncPlan => ({
  toDownload: Array.from({ length: count }, (_, i) => ({
    path: `mods/file-${i}.jar`,
    name: `file-${i}.jar`,
    size: 1,
    isDir: false,
    sha256: `sha-${i}`,
    url: `https://cdn.test.invalid/mods/file-${i}.jar`,
  })),
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set<string>(),
  bytesTotal: count,
});

describe('runDownloadPhase aborts siblings on first failure', () => {
  // DLI-58
  it('aborts the task and stops sibling workers when a download fails', async () => {
    const task = createSyncTask(SLUG, '/tmp/abort-client');
    // More files than workers, so without the abort each worker would shift a
    // second file after its first resolves.
    task.plan = downloadPlan(BUNDLE_DOWNLOAD_CONCURRENCY * 3);
    task.pendingDownloads = [...task.plan.toDownload];
    task.totalFiles = task.pendingDownloads.length;

    // One abort listener per parked worker exceeds the default cap of 10.
    setMaxListeners(BUNDLE_DOWNLOAD_CONCURRENCY + 1, task.abort.signal);

    let started = 0;
    mocks.downloadEntry.mockReset().mockImplementation(async () => {
      started += 1;
      const index = started;
      // The 2nd download fails; every other download resolves only after the
      // abort signal fires, so once abort lands no further file completes.
      if (index === 2) throw new Error('disk error');
      await new Promise<void>((resolve) => {
        if (task.abort.signal.aborted) {
          resolve();
          return;
        }
        task.abort.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    await expect(runSyncPhases(task, noopEmit)).rejects.toMatchObject({
      code: BundleErrorCodes.DOWNLOAD_FAILED,
    });

    expect(task.abort.signal.aborted).toBe(true);
    // Each worker begins exactly one file before the failure drains the queue
    // and aborts; no worker shifts a second file. Without the abort, started
    // would climb to the full plan size.
    expect(started).toBeLessThanOrEqual(BUNDLE_DOWNLOAD_CONCURRENCY);
  });
});
