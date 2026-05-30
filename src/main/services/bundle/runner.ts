import fs from 'node:fs/promises';
import type { ClientRequest } from 'node:http';
import path from 'node:path';
import {
  BUNDLE_DOWNLOAD_CONCURRENCY,
  BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS,
  BUNDLE_DOWNLOAD_SPEED_WINDOW_MS,
} from '@main/constants/bundle';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import {
  BundleErrorCodes,
  type BundleProgressEvent,
  type BundleSyncStatus,
  BundleSyncStatuses,
  type RemoteManifestEntry,
} from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { downloadEntry } from './download';
import { BundleError } from './errors';
import { isAncestor, resolveSafeEntryPath } from './paths';
import type { SyncPlan } from './plan';

const logger = scopedLogger('bundle.runner');

export type SyncTask = {
  slug: ClientSlug;
  clientFolder: string;
  plan: SyncPlan;
  abort: AbortController;
  // Set of in-flight HTTP requests for synchronous cancellation.
  currentRequests: Set<ClientRequest>;
  // Cooperative pause/cancel flags. Workers check between file boundaries.
  paused: boolean;
  cancelled: boolean;
  bytesDownloaded: number;
  speedWindowStart: number;
  speedWindowBytes: number;
  processedFiles: number;
  totalFiles: number;
  lastEmittedAt: number;
  currentFile?: string;
  pendingDownloads: RemoteManifestEntry[];
  pendingDeletes: string[];
};

export type EmitProgress = (
  slug: ClientSlug,
  status: BundleSyncStatus,
  patch?: Partial<BundleProgressEvent>,
) => void;

export type PhaseResult = {
  deletedAny: boolean;
};

// Coalesce progress emissions to one every BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS,
// otherwise we'd flood the renderer with hundreds of IPC pushes per second.
const maybeEmit = (
  task: SyncTask,
  status: BundleSyncStatus,
  emit: EmitProgress,
  force = false,
): void => {
  const now = Date.now();
  if (!force && now - task.lastEmittedAt < BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS) return;
  task.lastEmittedAt = now;
  const elapsed = now - task.speedWindowStart;
  let speed = 0;
  if (elapsed > 0) {
    speed = (task.speedWindowBytes / elapsed) * 1000;
  }
  if (elapsed > BUNDLE_DOWNLOAD_SPEED_WINDOW_MS) {
    task.speedWindowStart = now;
    task.speedWindowBytes = 0;
  }
  emit(task.slug, status, {
    processedFiles: task.processedFiles,
    totalFiles: task.totalFiles,
    toDownload: task.plan.toDownload.length + task.plan.toUpdate.length,
    toUpdate: task.plan.toUpdate.length,
    toDelete: task.plan.toDelete.length,
    toSkip: task.plan.toSkip.length,
    bytesDownloaded: task.bytesDownloaded,
    bytesTotal: task.plan.bytesTotal,
    speedBytesPerSec: Math.max(0, Math.round(speed)),
    ...(task.currentFile ? { currentFile: task.currentFile } : {}),
  });
};

const runDownloadWorker = async (task: SyncTask, emit: EmitProgress): Promise<void> => {
  while (!task.cancelled && !task.paused) {
    const entry = task.pendingDownloads.shift();
    if (!entry) return;
    task.currentFile = entry.path;
    const destPath = resolveSafeEntryPath(task.clientFolder, entry.path);
    await downloadEntry(entry, destPath, {
      currentRequests: task.currentRequests,
      signal: task.abort.signal,
      onChunk: (bytes) => {
        task.bytesDownloaded += bytes;
        task.speedWindowBytes += bytes;
        maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit);
      },
    });
    task.processedFiles += 1;
    maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit);
  }
};

const runDownloadPhase = async (task: SyncTask, emit: EmitProgress): Promise<void> => {
  if (task.pendingDownloads.length === 0) return;
  task.speedWindowStart = Date.now();
  task.speedWindowBytes = 0;
  maybeEmit(task, BundleSyncStatuses.DOWNLOADING, emit, true);
  const concurrency = Math.min(BUNDLE_DOWNLOAD_CONCURRENCY, task.pendingDownloads.length);
  const workers: Promise<void>[] = [];
  let firstError: unknown = null;
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      runDownloadWorker(task, emit).catch((err: unknown) => {
        if (!firstError) firstError = err;
        // Drain queue so other workers exit promptly.
        task.pendingDownloads.length = 0;
      }),
    );
  }
  await Promise.all(workers);
  if (firstError) {
    if (firstError instanceof BundleError) throw firstError;
    if (task.cancelled || task.abort.signal.aborted) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
    }
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Download phase failed: ${errorMessage(firstError)}`,
    );
  }
};

// Walk parent dirs upward, deleting each empty one until we hit either a
// non-empty directory or the client root (which we always preserve).
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
        // Already gone — keep walking up just in case the parent is empty too.
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
    if (task.cancelled || task.paused) break;
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
        // File already gone — count it as cleaned. We still don't mark
        // deletedAny because no actual file removal occurred and we have no
        // signal to heal from it.
        completedDeletes += 1;
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
  if (task.cancelled || task.paused) {
    task.pendingDeletes = task.pendingDeletes.slice(completedDeletes);
    return { deletedAny };
  }
  task.pendingDeletes = [];
  return { deletedAny };
};

export const runSyncPhases = async (task: SyncTask, emit: EmitProgress): Promise<PhaseResult> => {
  await runDownloadPhase(task, emit);
  if (task.cancelled || task.paused) {
    if (task.cancelled) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
    // Paused: leave deletes for resume.
    return { deletedAny: false };
  }
  const deleteResult = await runDeletePhase(task, emit);
  if (task.cancelled || task.paused) {
    if (task.cancelled) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
    return deleteResult;
  }
  return deleteResult;
};
