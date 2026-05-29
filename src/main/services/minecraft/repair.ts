import type { ClientSlug } from '@shared/contracts/ids';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import type { RepairOp } from './ops';
import {
  type PlannedInstallProgressRunner,
  createPlannedProgressAdapter,
  createRepairProgressAdapter,
  runWithProgressAdapter,
} from './progressAdapter';
import {
  finalizeRepairCancellation,
  finalizeRepairFailure,
  finalizeRepairSuccess,
  healForgeProcessors,
  verifyAndRepairBase,
} from './repairWorkflow';

export const runRepair = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: RepairOp,
): Promise<boolean> => {
  const progress = createRepairProgressAdapter(env, slug);
  try {
    env.logger.info(`[${slug}] repair: verifying & fixing…`);
    const repairOptions = {
      signal: op.abort.signal,
      onEvent: progress.onEvent,
    };
    const runPlannedInstallProgress: PlannedInstallProgressRunner = (plan) =>
      runWithProgressAdapter(createPlannedProgressAdapter(env, slug, plan), async (onEvent) => {
        await env.kit.install.run(plan, {
          signal: op.abort.signal,
          onEvent,
        });
      });
    await verifyAndRepairBase(env, slug, ctx, repairOptions);
    await healForgeProcessors(env, slug, ctx, {
      signal: op.abort.signal,
      runPlan: runPlannedInstallProgress,
    });
    await finalizeRepairSuccess(env, slug, ctx);
    return true;
  } catch (error) {
    if (op.abort.signal.aborted) {
      await finalizeRepairCancellation(env, slug, ctx);
      return false;
    }
    await finalizeRepairFailure({ env, slug, ctx, error, signal: op.abort.signal });
    return false;
  } finally {
    progress.dispose();
    env.ops.delete(slug);
  }
};
