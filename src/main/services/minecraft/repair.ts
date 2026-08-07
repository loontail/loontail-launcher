import type { CatalogKey } from '@shared/contracts/ids';
import type { Context } from './context';
import type { MinecraftEnv } from './env';
import type { RepairOp } from './ops';
import {
  createPlannedProgressAdapter,
  createRepairProgressAdapter,
  type PlannedInstallProgressRunner,
  runWithProgressAdapter,
} from './progressAdapter';
import {
  ensureLaunchable,
  finalizeRepairCancellation,
  finalizeRepairFailure,
  finalizeRepairSuccess,
  healForgeProcessors,
  verifyAndRepairBase,
} from './repairWorkflow';

export const runRepair = async (
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  op: RepairOp,
): Promise<boolean> => {
  const progress = createRepairProgressAdapter(env, key);
  try {
    env.logger.info(`[${key}] repair: verifying & fixing…`);
    const repairOptions = {
      signal: op.abort.signal,
      onEvent: progress.onEvent,
    };
    const runPlannedInstallProgress: PlannedInstallProgressRunner = (plan) =>
      runWithProgressAdapter(createPlannedProgressAdapter(env, key, plan), async (onEvent) => {
        await env.kit.install.run(plan, {
          signal: op.abort.signal,
          onEvent,
        });
      });
    await verifyAndRepairBase(env, key, ctx, repairOptions);
    await healForgeProcessors(env, key, ctx, {
      signal: op.abort.signal,
      runPlan: runPlannedInstallProgress,
    });
    await ensureLaunchable(env, key, ctx, {
      signal: op.abort.signal,
      runPlan: runPlannedInstallProgress,
    });
    await finalizeRepairSuccess(env, key, ctx);
    return true;
  } catch (error) {
    if (op.abort.signal.aborted) {
      await finalizeRepairCancellation(env, key);
      return false;
    }
    await finalizeRepairFailure({ env, key, error, signal: op.abort.signal });
    return false;
  } finally {
    progress.dispose();
    env.ops.delete(key);
  }
};
