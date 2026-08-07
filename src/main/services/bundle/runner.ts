import fs from 'node:fs/promises';
import type { ClientRequest } from 'node:http';
import path from 'node:path';
import {
  BUNDLE_DOWNLOAD_CONCURRENCY,
  BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS,
} from '@main/constants/bundle';
import { errorMessage } from '@main/infra/errorMessage';
import { isCancelled, isPaused, isRunning, type LifecyclePhase } from '@main/infra/lifecyclePhase';
import { scopedLogger } from '@main/infra/logger';
import {
  BundleErrorCodes,
  type BundleProgressEvent,
  type BundleSyncStatus,
  BundleSyncStatuses,
  type RemoteManifestEntry,
} from '@shared/contracts/bundle';
import type { CatalogKey } from '@shared/contracts/ids';
import { downloadEntry } from './download';
import { BundleError } from './errors';
import { isAncestor, resolveSafeEntryPath } from './paths';
import type { SyncPlan } from './plan';

const logger = scopedLogger('bundle.runner');

export type SyncTask = {
  key: CatalogKey;
  clientFolder: string;
  plan: SyncPlan;
  abort: AbortController;
  // In-flight HTTP requests, for synchronous cancellation.
  currentRequests: Set<ClientRequest>;
  // Cooperative lifecycle phase, checked between files (not mid-chunk). Mutate
  // only through the syncState mark* helpers.
  phase: LifecyclePhase;
  bytesDownloaded: number;
  processedFiles: number;
  totalFiles: number;
  lastEmittedAt: number;
  currentFile?: string;
  pendingDownloads: RemoteManifestEntry[];
  pendingDeletes: string[];
};

export type EmitProgress = (
  key: CatalogKey,
  status: BundleSyncStatus,
  patch?: Partial<BundleProgressEvent>,
) => void;

export type PhaseResult = {
  deletedAny: boolean;
};

export type SyncPhasesResult = {
  outcome: 'completed' | 'paused' | 'cancelled';
  deletedAny: boolean;
};

// Coalesce progress emissions, else hundreds of IPC pushes per second flood the
// renderer.
const maybeEmit = (
  task: SyncTask,
  status: BundleSyncStatus,
  emit: EmitProgress,
  force = false,
): void => {
  const now = Date.now();
  if (!force && now - task.lastEmittedAt < BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS) return;
  task.lastEmittedAt = now;
  emit(task.key, status, task.currentFile ? { currentFile: task.currentFile } : {});
};

const runDownloadWorker = async (task: SyncTask, emit: EmitProgress): Promise<void> => {
  while (isRunning(task)) {
    const entry = task.pendingDownloads.shift();
    if (!entry) return;
    task.currentFile = entry.path;
    const destPath = resolveSafeEntryPath(task.clientFolder, entry.path);
    await downloadEntry(entry, destPath, {
      currentRequests: task.currentRequests,
      signal: task.abort.signal,
      onChunk: (bytes) => {
        task.bytesDownloaded += bytes;
        maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit);
      },
    });
    task.processedFiles += 1;
    maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit);
  }
};

const runDownloadPhase = async (task: SyncTask, emit: EmitProgress): Promise<void> => {
  if (task.pendingDownloads.length === 0) return;
  maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit, true);
  const concurrency = Math.min(BUNDLE_DOWNLOAD_CONCURRENCY, task.pendingDownloads.length);
  const workers: Promise<void>[] = [];
  let firstError: unknown = null;
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      runDownloadWorker(task, emit).catch((err: unknown) => {
        if (firstError) {
          // Only the first failure is thrown; log the rest so a discarded
          // secondary cause stays traceable.
          logger.debug(`[${task.key}] secondary download worker error discarded`, err);
        } else {
          firstError = err;
        }
        // Drain the queue and abort so siblings already mid-flight stop too.
        task.pendingDownloads.length = 0;
        task.abort.abort();
      }),
    );
  }
  await Promise.all(workers);
  if (firstError) {
    if (firstError instanceof BundleError) throw firstError;
    // The failure-abort above also flips signal.aborted, so don't map it to
    // ABORTED — only a real cancel (phase no longer running) does.
    if (!isRunning(task)) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
    }
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Download phase failed: ${errorMessage(firstError)}`,
    );
  }
};

// Delete empty parent dirs upward, stopping at a non-empty dir or the client
// root (always preserved).
const cleanEmptyDirs = async (clientFolder: string, leafDir: string): Promise<void> => {
  let current = leafDir;
  while (isAncestor(clientFolder, current)) {
    try {
      const remaining = await fs.readdir(current);
      if (remaining.length > 0) return;
      await fs.rmdir(current);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Already gone — keep walking up in case the parent is empty too.
      } else if (code === 'ENOTEMPTY') {
        return;
      } else {
        logger.warn(`Failed to rmdir empty parent ${current}`, err);
        return;
      }
    }
    current = path.dirname(current);
  }
};

const runDeletePhase = async (task: SyncTask, emit: EmitProgress): Promise<PhaseResult> => {
  if (task.pendingDeletes.length === 0) return { deletedAny: false };
  maybeEmit(task, BundleSyncStatuses.DELETING, emit, true);
  let deletedAny = false;
  let completedDeletes = 0;
  for (const relativePath of task.pendingDeletes) {
    if (!isRunning(task)) break;
    let target: string;
    try {
      target = resolveSafeEntryPath(task.clientFolder, relativePath);
    } catch (err) {
      throw err instanceof BundleError
        ? err
        : new BundleError(
            BundleErrorCodes.DELETE_FAILED,
            `Refusing to delete unsafe path ${relativePath}`,
          );
    }
    try {
      await fs.unlink(target);
      deletedAny = true;
      await cleanEmptyDirs(task.clientFolder, path.dirname(target));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Already gone, but still flag deletedAny so the heal pass reconciles any
        // vanilla file this path was overriding, and count it as processed so the
        // progress bar doesn't stall.
        deletedAny = true;
        completedDeletes += 1;
        task.processedFiles += 1;
        maybeEmit(task, BundleSyncStatuses.DELETING, emit);
        continue;
      }
      throw new BundleError(
        BundleErrorCodes.DELETE_FAILED,
        `Failed to delete ${relativePath}: ${errorMessage(err)}`,
      );
    }
    completedDeletes += 1;
    task.processedFiles += 1;
    maybeEmit(task, BundleSyncStatuses.DELETING, emit);
  }
  if (!isRunning(task)) {
    task.pendingDeletes = task.pendingDeletes.slice(completedDeletes);
    return { deletedAny };
  }
  task.pendingDeletes = [];
  return { deletedAny };
};

export const runSyncPhases = async (
  task: SyncTask,
  emit: EmitProgress,
): Promise<SyncPhasesResult> => {
  await runDownloadPhase(task, emit);
  // Check cancel first so it overrides a pause: cancel throws ABORTED (terminal),
  // a pause returns 'paused' and leaves deletes for resume.
  if (isCancelled(task)) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
  if (isPaused(task)) {
    return { outcome: 'paused', deletedAny: false };
  }
  const deleteResult = await runDeletePhase(task, emit);
  if (isCancelled(task)) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
  return {
    outcome: isPaused(task) ? 'paused' : 'completed',
    deletedAny: deleteResult.deletedAny,
  };
};
