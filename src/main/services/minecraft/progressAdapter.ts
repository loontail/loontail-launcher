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
import { createThrottledEmitter } from '@main/infra/throttledEmitter';
import type { CatalogKey } from '@shared/contracts/ids';
import {
  type MinecraftProgressEvent,
  type ProgressStage,
  ProgressStages,
} from '@shared/contracts/minecraft';
import { createSpeedWindow } from '@shared/lib/speedWindow';
import type { ManagerEnv } from './env';

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

// 4s rolling window, mirroring the renderer's useByteSpeed: wide enough to
// smooth the kit's per-second jitter, short enough to react to a slowdown.
const SPEED_WINDOW_MS = 4000;

// The kit reports `bytesDownloaded` install-wide but `totalBytes` per stage, so
// the two are mixed-scale. Reconstruct per-stage bytes from stagePercent so the
// emitted "X / Y" line is self-consistent, and sample throughput over those
// reconstructed bytes — resetting at each stage boundary so the rate (and ETA)
// don't dip negative when the next stage restarts at 0%.
const createSnapshotEmitter = (env: ManagerEnv, slug: CatalogKey) => {
  let stage: ProgressStage | null = null;
  const speedWindow = createSpeedWindow(SPEED_WINDOW_MS);

  return (snapshot: ProgressSnapshot): void => {
    const stageTotal = snapshot.totalBytes;
    const fraction = Math.min(100, Math.max(0, snapshot.stagePercent)) / 100;
    const stageDone = stageTotal > 0 ? Math.round(fraction * stageTotal) : 0;

    if (snapshot.stage !== stage) {
      stage = snapshot.stage;
      speedWindow.reset();
    }
    const speedBytesPerSec = Math.max(0, Math.round(speedWindow.sample(stageDone, Date.now())));

    env.broadcaster.progress({
      slug,
      stage: snapshot.stage,
      stagePercent: snapshot.stagePercent,
      overallPercent: snapshot.overallPercent,
      bytesDownloaded: stageDone,
      totalBytes: stageTotal,
      speedBytesPerSec,
      ...(snapshot.currentFile !== undefined ? { currentFile: snapshot.currentFile } : {}),
    });
  };
};

export const createPlannedProgressAdapter = (
  env: ManagerEnv,
  slug: CatalogKey,
  plan: Pick<InstallPlan, 'actions'>,
): MinecraftProgressAdapter => {
  const tracker = createInstallProgressTracker(plan);
  const unsubscribe = tracker.subscribe(createSnapshotEmitter(env, slug));

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
  const aspect = event.aspect;
  return aspect === undefined ? null : PROGRESS_STAGE_FOR_ASPECT[aspect];
};

type ThrottledProgress = {
  readonly stage: ProgressStage;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
  readonly currentFile: string | undefined;
};

export const createRepairProgressAdapter = (
  env: ManagerEnv,
  slug: CatalogKey,
): MinecraftProgressAdapter => {
  const emitter = createThrottledEmitter<ThrottledProgress>((progress) => {
    const { stage, bytesDownloaded, totalBytes, currentFile } = progress;
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
  });
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
    emitter.push({ stage, bytesDownloaded, totalBytes, currentFile });
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
