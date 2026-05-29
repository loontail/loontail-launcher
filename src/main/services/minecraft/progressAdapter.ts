import {
  DownloadCategories,
  EventTypes,
  type InstallPlan,
  type ProgressListener,
  type ProgressSnapshot,
  type VerificationKind,
  VerificationKinds,
  VerifyFileCategories,
  type VerifyFileCategory,
  createInstallProgressTracker,
} from '@loontail/minecraft-kit';
import type { ClientSlug } from '@shared/contracts/ids';
import {
  type MinecraftProgressEvent,
  type ProgressStage,
  ProgressStages,
} from '@shared/contracts/minecraft';
import type { ManagerEnv } from './env';

const PROGRESS_THROTTLE_MS = 100;
const PROGRESS_STAGE_FOR_ASPECT: Record<VerificationKind, ProgressStage> = {
  [VerificationKinds.MINECRAFT]: ProgressStages.MINECRAFT,
  [VerificationKinds.RUNTIME]: ProgressStages.RUNTIME,
  [VerificationKinds.FABRIC]: ProgressStages.LOADER,
  [VerificationKinds.FORGE]: ProgressStages.LOADER,
};

export type MinecraftProgressAdapter = {
  readonly onEvent: ProgressListener;
  readonly dispose: () => void;
};

export type PlannedInstallProgressRunner = (plan: InstallPlan) => Promise<void>;

type AspectTaggedProgressEvent = Parameters<ProgressListener>[0] & {
  readonly aspect?: VerificationKind;
};

const emitSnapshot = (env: ManagerEnv, slug: ClientSlug, snapshot: ProgressSnapshot): void => {
  env.broadcaster.progress({
    slug,
    stage: snapshot.stage,
    stagePercent: snapshot.stagePercent,
    overallPercent: snapshot.overallPercent,
    bytesDownloaded: snapshot.bytesDownloaded,
    totalBytes: snapshot.totalBytes,
    ...(snapshot.currentFile !== undefined ? { currentFile: snapshot.currentFile } : {}),
  });
};

export const createPlannedProgressAdapter = (
  env: ManagerEnv,
  slug: ClientSlug,
  plan: Pick<InstallPlan, 'actions'>,
): MinecraftProgressAdapter => {
  const tracker = createInstallProgressTracker(plan);
  const unsubscribe = tracker.subscribe((snapshot) => emitSnapshot(env, slug, snapshot));

  return {
    onEvent: tracker.onEvent,
    dispose: () => {
      tracker.finish();
      unsubscribe();
    },
  };
};

const progressStageForDownloadCategory = (category: string | undefined): ProgressStage | null => {
  switch (category) {
    case DownloadCategories.RUNTIME_FILE:
      return ProgressStages.RUNTIME;
    case DownloadCategories.FABRIC_LIBRARY:
    case DownloadCategories.FORGE_LIBRARY:
    case DownloadCategories.FORGE_INSTALLER:
      return ProgressStages.LOADER;
    case DownloadCategories.CLIENT_JAR:
    case DownloadCategories.LIBRARY:
    case DownloadCategories.ASSET_INDEX:
    case DownloadCategories.ASSET:
    case DownloadCategories.LOGGING_CONFIG:
      return ProgressStages.MINECRAFT;
    default:
      return null;
  }
};

const progressStageForVerifyCategory = (category: VerifyFileCategory): ProgressStage => {
  switch (category) {
    case VerifyFileCategories.RUNTIME_FILE:
      return ProgressStages.RUNTIME;
    case VerifyFileCategories.LOADER_LIBRARY:
      return ProgressStages.LOADER;
    case VerifyFileCategories.CLIENT_JAR:
    case VerifyFileCategories.LIBRARY:
    case VerifyFileCategories.ASSET:
    case VerifyFileCategories.ASSET_INDEX:
    case VerifyFileCategories.NATIVE:
    case VerifyFileCategories.LOGGING_CONFIG:
      return ProgressStages.MINECRAFT;
  }
};

const progressStageForAspect = (event: Parameters<ProgressListener>[0]): ProgressStage | null => {
  const aspect = (event as AspectTaggedProgressEvent).aspect;
  return aspect === undefined ? null : PROGRESS_STAGE_FOR_ASPECT[aspect];
};

type ThrottledProgress = {
  readonly stage: ProgressStage;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
  readonly currentFile: string | undefined;
};

type ThrottledProgressEmitter = {
  readonly emit: (progress: ThrottledProgress) => void;
  readonly dispose: () => void;
};

const createThrottledProgressEmitter = (
  env: ManagerEnv,
  slug: ClientSlug,
): ThrottledProgressEmitter => {
  let current: ThrottledProgress | null = null;
  let lastEmittedAt = 0;
  let pendingFlush: NodeJS.Timeout | null = null;

  const flush = (): void => {
    lastEmittedAt = Date.now();
    pendingFlush = null;
    if (current === null) return;
    const { stage, bytesDownloaded, totalBytes, currentFile } = current;
    const percent = totalBytes > 0 ? Math.min(100, (bytesDownloaded / totalBytes) * 100) : 0;
    const event: MinecraftProgressEvent = {
      slug,
      stage,
      stagePercent: percent,
      overallPercent: percent,
      bytesDownloaded,
      totalBytes,
      ...(currentFile !== undefined ? { currentFile } : {}),
    };
    env.broadcaster.progress(event);
  };

  const clearPendingFlush = (): void => {
    if (pendingFlush === null) return;
    clearTimeout(pendingFlush);
    pendingFlush = null;
  };

  return {
    emit: (progress) => {
      current = progress;
      const elapsed = Date.now() - lastEmittedAt;
      if (elapsed >= PROGRESS_THROTTLE_MS) {
        clearPendingFlush();
        flush();
      } else if (pendingFlush === null) {
        pendingFlush = setTimeout(flush, PROGRESS_THROTTLE_MS - elapsed);
        if (typeof pendingFlush.unref === 'function') pendingFlush.unref();
      }
    },
    dispose: clearPendingFlush,
  };
};

export const createRepairProgressAdapter = (
  env: ManagerEnv,
  slug: ClientSlug,
): MinecraftProgressAdapter => {
  const emitter = createThrottledProgressEmitter(env, slug);
  let stage: ProgressStage = ProgressStages.PREPARE;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let currentFile: string | undefined;

  const setStage = (nextStage: ProgressStage | null): void => {
    if (nextStage === null || nextStage === stage) return;
    stage = nextStage;
    bytesDownloaded = 0;
    totalBytes = 0;
    currentFile = undefined;
  };

  const emit = (): void => {
    emitter.emit({ stage, bytesDownloaded, totalBytes, currentFile });
  };

  const onEvent: ProgressListener = (event) => {
    switch (event.type) {
      case EventTypes.DOWNLOAD_PROGRESS:
        setStage(
          progressStageForAspect(event) ?? progressStageForDownloadCategory(event.file.category),
        );
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        emit();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        setStage(
          progressStageForAspect(event) ?? progressStageForDownloadCategory(event.file.category),
        );
        currentFile = event.file.target;
        emit();
        return;
      case EventTypes.VERIFY_FILE_CHECKED:
        setStage(
          progressStageForAspect(event) ?? progressStageForVerifyCategory(event.file.category),
        );
        currentFile = event.file.path;
        emit();
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

export const runWithProgressAdapter = async <T>(
  adapter: MinecraftProgressAdapter,
  run: (onEvent: ProgressListener) => Promise<T>,
): Promise<T> => {
  try {
    return await run(adapter.onEvent);
  } finally {
    adapter.dispose();
  }
};
