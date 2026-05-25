import { EventTypes, type ProgressListener } from '@loontail/minecraft-kit';
import type { ClientSlug } from '@shared/contracts/ids';
import {
  InstallStatuses,
  type MinecraftProgressEvent,
  ProgressStages,
} from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage } from './errors';
import { repairMissingForgeProcessorOutputs } from './forgeProcessorHealing';
import type { RepairOp } from './ops';

const PROGRESS_THROTTLE_MS = 100;

// Kit's `repair.all` does not expose a plan ahead of time, so the per-action
// totals used by `createInstallProgressTracker` are unavailable. Instead, fold
// per-file events into a coarse snapshot driven by the current download/verify
// activity, and throttle the broadcast to avoid flooding the renderer.
const createRepairProgressListener = (env: ManagerEnv, slug: ClientSlug): ProgressListener => {
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
      stage: ProgressStages.MINECRAFT,
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

  return (event) => {
    switch (event.type) {
      case EventTypes.DOWNLOAD_PROGRESS:
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.VERIFY_FILE_CHECKED:
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

    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } catch (error) {
    env.logger.error(`[${slug}] repair: failed`, error);
    env.emitError(slug, classifyError(error, op.abort.signal), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } finally {
    env.ops.delete(slug);
  }
};
