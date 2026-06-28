import { EventTypes, type ProgressListener } from '@loontail/minecraft-kit';
import { createThrottledEmitter } from '@main/infra/throttledEmitter';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import type { CatalogKey } from '@shared/contracts/ids';
import type { EmitProgress } from './runner';

export type HealProgressListener = {
  readonly onEvent: ProgressListener;
  readonly dispose: () => void;
};

type HealProgress = {
  readonly verifiedFiles: number;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
  readonly currentFile: string | undefined;
};

export const createHealProgressListener = (
  slug: CatalogKey,
  emit: EmitProgress,
): HealProgressListener => {
  let verifiedFiles = 0;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let currentFile: string | undefined;

  const emitter = createThrottledEmitter<HealProgress>((value) => {
    // Patch bytes explicitly (even 0/0): makeProgressEvent's defaults pull the
    // just-finished download phase's totals, which would leak into HEALING events.
    emit(slug, BundleSyncStatuses.HEALING, {
      processedFiles: value.verifiedFiles,
      bytesDownloaded: value.bytesDownloaded,
      bytesTotal: value.totalBytes,
      ...(value.currentFile !== undefined ? { currentFile: value.currentFile } : {}),
    });
  });

  const push = (): void => {
    emitter.push({ verifiedFiles, bytesDownloaded, totalBytes, currentFile });
  };

  const onEvent: ProgressListener = (event) => {
    switch (event.type) {
      case EventTypes.VERIFY_FILE_CHECKED:
        verifiedFiles += 1;
        currentFile = event.file.path;
        push();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        currentFile = event.file.target;
        push();
        return;
      case EventTypes.DOWNLOAD_PROGRESS:
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        push();
        return;
      default:
        return;
    }
  };

  return {
    onEvent,
    dispose: emitter.dispose,
  };
};
