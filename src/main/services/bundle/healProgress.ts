import { EventTypes, type ProgressListener } from '@loontail/minecraft-kit';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import type { EmitProgress } from './runner';

const HEAL_PROGRESS_THROTTLE_MS = 100;

export type HealProgressListener = {
  readonly onEvent: ProgressListener;
  readonly dispose: () => void;
};

export const createHealProgressListener = (
  slug: ClientSlug,
  emit: EmitProgress,
): HealProgressListener => {
  let verifiedFiles = 0;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let currentFile: string | undefined;
  let lastEmittedAt = 0;
  let pendingFlush: NodeJS.Timeout | null = null;

  const flush = (): void => {
    lastEmittedAt = Date.now();
    pendingFlush = null;
    emit(slug, BundleSyncStatuses.HEALING, {
      processedFiles: verifiedFiles,
      ...(totalBytes > 0 ? { bytesDownloaded, bytesTotal: totalBytes } : {}),
      ...(currentFile !== undefined ? { currentFile } : {}),
    });
  };

  const clearPendingFlush = (): void => {
    if (pendingFlush === null) return;
    clearTimeout(pendingFlush);
    pendingFlush = null;
  };

  const scheduleFlush = (): void => {
    const elapsed = Date.now() - lastEmittedAt;
    if (elapsed >= HEAL_PROGRESS_THROTTLE_MS) {
      clearPendingFlush();
      flush();
      return;
    }
    if (pendingFlush === null) {
      pendingFlush = setTimeout(flush, HEAL_PROGRESS_THROTTLE_MS - elapsed);
      if (typeof pendingFlush.unref === 'function') pendingFlush.unref();
    }
  };

  const onEvent: ProgressListener = (event) => {
    switch (event.type) {
      case EventTypes.VERIFY_FILE_CHECKED:
        verifiedFiles += 1;
        currentFile = event.file.path;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_PROGRESS:
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        scheduleFlush();
        return;
      default:
        return;
    }
  };

  return {
    onEvent,
    dispose: clearPendingFlush,
  };
};
