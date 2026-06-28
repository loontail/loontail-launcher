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
import type { CatalogKey } from '@shared/contracts/ids';
import { downloadEntry } from './download';
import { BundleError } from './errors';
import { isAncestor, resolveSafeEntryPath } from './paths';
import type { SyncPlan } from './plan';
import { type SyncPhase, isCancelled, isPaused, isRunning } from './syncState';

const logger = scopedLogger('bundle.runner');

export type SyncTask = {
  slug: CatalogKey;
  clientFolder: string;
  plan: SyncPlan;
  abort: AbortController;
  // Set of in-flight HTTP requests for synchronous cancellation.
  currentRequests: Set<ClientRequest>;
  // Cooperative lifecycle phase. Workers check it between file boundaries, not
  // mid-chunk. Transition through the syncState mark* helpers (cancel overrides
  // pause; cancel is terminal) — never assign 'cancelled'→'running' directly.
  phase: SyncPhase;
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
  slug: CatalogKey,
  status: BundleSyncStatus,
  patch?: Partial<BundleProgressEvent>,
) => void;

export type PhaseResult = {
  deletedAny: boolean;
};

// Discriminated outcome of a full sync run. The manager reads `outcome` on the
// resolved path; the thrown ABORTED on cancel is decoded against `task.phase`.
export type SyncPhasesResult = {
  outcome: 'completed' | 'paused' | 'cancelled';
  deletedAny: boolean;
};

const syncPhasesResult = (
  outcome: SyncPhasesResult['outcome'],
  deletedAny: boolean,
): SyncPhasesResult => ({
  outcome,
  deletedAny,
});

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
    speedBytesPerSec: Math.max(0, Math.round(speed)),
    ...(task.currentFile ? { currentFile: task.currentFile } : {}),
  });
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
        if (firstError) {
          // Only the first failure is reported; log the rest so a discarded
          // secondary cause is still traceable (the abort below makes siblings
          // reject with the same propagated signal error).
          logger.debug(`[${task.slug}] secondary download worker error discarded`, err);
        } else {
          firstError = err;
        }
        // Drain queue so other workers exit promptly, and abort to cancel any
        // sibling download already mid-flight instead of letting it run to
        // completion.
        task.pendingDownloads.length = 0;
        task.abort.abort();
      }),
    );
  }
  await Promise.all(workers);
  if (firstError) {
    if (firstError instanceof BundleError) throw firstError;
    // Only user-initiated cancel/pause maps to ABORTED. The internal
    // failure-abort above also flips signal.aborted, so it must not be confused
    // with a genuine cancel — a non-BundleError failure stays DOWNLOAD_FAILED.
    if (!isRunning(task)) {
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
        // File already gone — still flag deletedAny so the heal pass runs. The
        // bundle no longer owns this path, so any vanilla file it was
        // overriding must be reconciled even when the delete itself was a no-op.
        // A missing target is still a processed unit of work, so count it toward
        // processedFiles like a real delete; otherwise the progress bar stalls.
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
  // why: cancel throws ABORTED (cancel is terminal — manager.ts decodes the
  // thrown error against the phase); a pause returns the 'paused' outcome and
  // leaves deletes for resume. Check cancel first so it overrides a pause.
  if (isCancelled(task)) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
  if (isPaused(task)) {
    // Leave deletes for resume.
    return syncPhasesResult('paused', false);
  }
  const deleteResult = await runDeletePhase(task, emit);
  if (isCancelled(task)) throw new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled');
  return syncPhasesResult(isPaused(task) ? 'paused' : 'completed', deleteResult.deletedAny);
};
