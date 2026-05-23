import type { MinecraftKit } from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import { verifyAndRepairExceptBundle } from '@main/services/minecraft/bundleHealing';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { BundleError, errorMessage } from './errors';

const logger = scopedLogger('bundle.healer');

export type Healer = {
  // Called by the bundle manager after the delete phase. Verifies the
  // minecraft slice and re-downloads any vanilla file the bundle no longer
  // claims ownership of. Bundle-owned files are skipped so deliberate
  // overrides survive the heal pass.
  healAfterDeletes: (
    slug: ClientSlug,
    bundleOwnedPaths: ReadonlySet<string>,
    signal?: AbortSignal,
  ) => Promise<void>;
};

export const createHealer = (kit: MinecraftKit): Healer => ({
  healAfterDeletes: async (slug, bundleOwnedPaths, signal) => {
    try {
      const outcome = await verifyAndRepairExceptBundle(kit, slug, bundleOwnedPaths, signal);
      logger.info(
        `[${slug}] heal complete (repaired=${outcome.repaired}, ignoredByBundle=${outcome.ignoredByBundle})`,
      );
    } catch (err) {
      if (signal?.aborted) {
        throw new BundleError(BundleErrorCodes.ABORTED, 'Heal aborted');
      }
      logger.error(`[${slug}] heal failed`, err);
      throw new BundleError(
        BundleErrorCodes.HEAL_FAILED,
        `Heal after delete failed: ${errorMessage(err)}`,
      );
    }
  },
});
