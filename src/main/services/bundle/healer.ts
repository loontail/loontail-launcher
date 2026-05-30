import type { MinecraftKit, ProgressListener } from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { verifyAndRepairExceptBundle } from '@main/services/minecraft/bundleHealing';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { BundleError } from './errors';

const logger = scopedLogger('bundle.healer');

export type HealOptions = {
  signal?: AbortSignal;
  // Forwarded to the kit's verify + repair calls so the bundle manager can
  // surface live progress while in the HEALING status.
  onEvent?: ProgressListener;
};

export type Healer = {
  // Called by the bundle manager after the delete phase. Verifies the
  // minecraft slice and re-downloads any vanilla file the bundle no longer
  // claims ownership of. Bundle-owned files are skipped so deliberate
  // overrides survive the heal pass.
  healAfterDeletes: (
    slug: ClientSlug,
    bundleOwnedPaths: ReadonlySet<string>,
    options?: HealOptions,
  ) => Promise<void>;
};

export const createHealer = (kit: MinecraftKit): Healer => ({
  healAfterDeletes: async (slug, bundleOwnedPaths, options) => {
    try {
      const outcome = await verifyAndRepairExceptBundle(kit, slug, bundleOwnedPaths, options);
      logger.info(
        `[${slug}] heal complete (repaired=${outcome.repaired}, ignoredByBundle=${outcome.ignoredByBundle})`,
      );
    } catch (err) {
      if (options?.signal?.aborted) {
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
