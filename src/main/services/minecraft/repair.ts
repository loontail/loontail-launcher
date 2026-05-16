import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage } from './errors';
import type { RepairOp } from './ops';

export const runRepair = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: RepairOp,
): Promise<void> => {
  try {
    env.logger.info(`[${slug}] repair: verifying & fixing…`);
    const report = await env.kit.repair.all(ctx.target, { signal: op.abort.signal });
    const broken = [...report.repairs.keys()];
    env.logger.info(
      broken.length === 0
        ? `[${slug}] repair: clean`
        : `[${slug}] repair: fixed ${broken.join(', ')}`,
    );
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } catch (error) {
    env.logger.error(`[${slug}] repair: failed`, error);
    env.emitError(slug, classifyError(error, op.abort.signal), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  } finally {
    env.ops.delete(slug);
  }
};
