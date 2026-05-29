import {
  DownloadCategories,
  EventTypes,
  type ProgressListener,
  type VerificationKind,
  VerificationKinds,
  VerifyFileCategories,
  type VerifyFileCategory,
} from '@loontail/minecraft-kit';
import type { ClientSlug } from '@shared/contracts/ids';
import {
  InstallStatuses,
  type MinecraftProgressEvent,
  type ProgressStage,
  ProgressStages,
} from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage } from './errors';
import { repairMissingForgeProcessorOutputs } from './forgeProcessorHealing';
import type { RepairOp } from './ops';
import { runtimePathFor } from './runtimeFs';

const PROGRESS_THROTTLE_MS = 100;
const PROGRESS_STAGE_FOR_ASPECT: Record<VerificationKind, ProgressStage> = {
  [VerificationKinds.MINECRAFT]: ProgressStages.MINECRAFT,
  [VerificationKinds.RUNTIME]: ProgressStages.RUNTIME,
  [VerificationKinds.FABRIC]: ProgressStages.LOADER,
  [VerificationKinds.FORGE]: ProgressStages.LOADER,
};

type AspectTaggedProgressEvent = Parameters<ProgressListener>[0] & {
  readonly aspect?: VerificationKind;
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

// Kit's `repair.all` does not expose a plan ahead of time, so the per-action
// totals used by `createInstallProgressTracker` are unavailable. Instead, fold
// per-file events into a coarse snapshot driven by the current download/verify
// activity, and throttle the broadcast to avoid flooding the renderer.
const createRepairProgressListener = (env: ManagerEnv, slug: ClientSlug): ProgressListener => {
  let stage: ProgressStage = ProgressStages.MINECRAFT;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let currentFile: string | undefined;
  let lastEmittedAt = 0;
  let pendingFlush: NodeJS.Timeout | null = null;

  const flush = (): void => {
    lastEmittedAt = Date.now();
    pendingFlush = null;
    const event: MinecraftProgressEvent = {
      slug,
      stage,
      stagePercent: totalBytes > 0 ? Math.min(100, (bytesDownloaded / totalBytes) * 100) : 0,
      overallPercent: totalBytes > 0 ? Math.min(100, (bytesDownloaded / totalBytes) * 100) : 0,
      bytesDownloaded,
      totalBytes,
      ...(currentFile !== undefined ? { currentFile } : {}),
    };
    env.broadcaster.progress(event);
  };

  const scheduleFlush = (): void => {
    const elapsed = Date.now() - lastEmittedAt;
    if (elapsed >= PROGRESS_THROTTLE_MS) {
      if (pendingFlush !== null) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      flush();
    } else if (pendingFlush === null) {
      pendingFlush = setTimeout(flush, PROGRESS_THROTTLE_MS - elapsed);
    }
  };

  const setStage = (nextStage: ProgressStage | null): void => {
    if (nextStage === null || nextStage === stage) return;
    stage = nextStage;
    bytesDownloaded = 0;
    totalBytes = 0;
    currentFile = undefined;
  };

  return (event) => {
    switch (event.type) {
      case EventTypes.DOWNLOAD_PROGRESS:
        setStage(
          progressStageForAspect(event) ?? progressStageForDownloadCategory(event.file.category),
        );
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        setStage(
          progressStageForAspect(event) ?? progressStageForDownloadCategory(event.file.category),
        );
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.VERIFY_FILE_CHECKED:
        setStage(
          progressStageForAspect(event) ?? progressStageForVerifyCategory(event.file.category),
        );
        currentFile = event.file.path;
        scheduleFlush();
        return;
      default:
        return;
    }
  };
};

export const runRepair = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: RepairOp,
): Promise<void> => {
  try {
    env.logger.info(`[${slug}] repair: verifying & fixing…`);
    const onEvent = createRepairProgressListener(env, slug);
    const report = await env.kit.repair.all(ctx.target, {
      signal: op.abort.signal,
      onEvent,
    });
    const broken = [...report.repairs.keys()];
    env.logger.info(
      broken.length === 0
        ? `[${slug}] repair: clean`
        : `[${slug}] repair: fixed ${broken.join(', ')}`,
    );

    // Forge processor outputs (srg/extra/forge-client jars) are NOT declared
    // libraries, so kit.verify.forge can't see them and kit.repair.all skips
    // them. Re-run only the processors whose outputs are missing on disk.
    const processorOutcome = await repairMissingForgeProcessorOutputs(
      env.kit,
      slug,
      ctx.target,
      op.abort.signal,
    );
    if (processorOutcome.ranProcessors) {
      env.logger.info(`[${slug}] repair: re-ran ${processorOutcome.reranCount} forge processor(s)`);
    }

    env.persistRuntime(slug, {
      component: ctx.target.runtime.component,
      path: runtimePathFor(ctx.target.runtime.component),
    });
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } catch (error) {
    env.logger.error(`[${slug}] repair: failed`, error);
    env.emitError(slug, classifyError(error, op.abort.signal), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } finally {
    env.ops.delete(slug);
  }
};
