import type { MinecraftKit, ProgressListener, Target } from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { verifyAndRepairExceptBundle } from '@main/services/minecraft/bundleHealing';
import { buildContext } from '@main/services/minecraft/context';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { BundleError } from './errors';

const logger = scopedLogger('bundle.heal');

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

// Injection seam: tests stub the context build so the heal seam can be
// exercised without a Strapi/settings round-trip.
export type ResolvedHealContext = { target: Target; clientFolder: string };

export type CreateHealerDeps = {
  resolveContext: (kit: MinecraftKit, slug: ClientSlug) => Promise<ResolvedHealContext>;
};

export const createHealer = (
  kit: MinecraftKit,
  deps: CreateHealerDeps = {
    resolveContext: async (k, slug) => {
      const ctx = await buildContext(k, slug);
      return { target: ctx.target, clientFolder: ctx.clientFolder };
    },
  },
): Healer => ({
  healAfterDeletes: async (slug, bundleOwnedPaths, options) => {
    try {
      // Resolve the minecraft target once here (the heal bridge no longer does
      // it), so the verify/repair pass runs against a single resolution.
      const { target, clientFolder } = await deps.resolveContext(kit, slug);
      const outcome = await verifyAndRepairExceptBundle(
        kit,
        target,
        clientFolder,
        bundleOwnedPaths,
        options,
      );
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
