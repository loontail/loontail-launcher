import type {
  MinecraftKit,
  ProgressListener,
  Target,
  VerificationResult,
} from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { CatalogKey } from '@shared/contracts/ids';
import { BundleError } from './errors';
import { createBundleRepairIssueFilter, isBundleOwnedIssue } from './ownership';

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
    slug: CatalogKey,
    bundleOwnedPaths: ReadonlySet<string>,
    options?: HealOptions,
  ) => Promise<void>;
};

export type ResolvedHealContext = { target: Target; clientFolder: string };

// Injection seam (heal port): the bundle service no longer imports minecraft to
// resolve the heal target. The composition root injects this from the minecraft
// manager so the verify/repair pass runs against a single resolution.
export type CreateHealerDeps = {
  resolveContext: (slug: CatalogKey) => Promise<ResolvedHealContext>;
};

type HealOutcome = {
  // Files the bundle currently owns — never repaired even if kit verify flags
  // them as wrong-sha1 (the bundle deliberately overrides vanilla).
  ignoredByBundle: number;
  // Files outside the bundle's ownership that we actually re-downloaded.
  repaired: number;
};

// exactOptionalPropertyTypes is on and the kit options reject an explicit
// `undefined`, so build the forwarded options conditionally.
const opOptions = (
  options: HealOptions | undefined,
): { signal?: AbortSignal; onEvent?: ProgressListener } => ({
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
});

const countBundleOwnedIssues = (
  result: VerificationResult,
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
): number =>
  result.issues.filter((issue) => isBundleOwnedIssue(clientFolder, bundleOwnedPaths, issue.path))
    .length;

// Run kit.verify.minecraft, drop any issues for paths the bundle owns, then
// repair only what's left. No-op when the filtered set is empty. The caller
// passes the already-resolved minecraft target + clientFolder, so this never
// re-resolves the target (no CMS/settings round-trip in the heal path).
const verifyAndRepairExceptBundle = async (
  kit: MinecraftKit,
  target: Target,
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
  options?: HealOptions,
): Promise<HealOutcome> => {
  const result = await kit.verify.minecraft.run(target, opOptions(options));
  const shouldRepairIssue = createBundleRepairIssueFilter(clientFolder, bundleOwnedPaths);
  const ignoredByBundle = countBundleOwnedIssues(result, clientFolder, bundleOwnedPaths);
  const repairableIssues = result.issues.length - ignoredByBundle;

  if (repairableIssues === 0) {
    logger.info(
      `heal: minecraft slice clean (verified=${result.checkedFiles}, ignored=${ignoredByBundle})`,
    );
    return { ignoredByBundle, repaired: 0 };
  }

  logger.info(
    `heal: repairing ${repairableIssues} minecraft files (ignored ${ignoredByBundle} bundle-owned)`,
  );

  const plan = await kit.repair.minecraft.plan(target, {
    from: result,
    shouldRepairIssue,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (plan.totalActions > 0) {
    await kit.repair.minecraft.run(plan, opOptions(options));
  }

  return { ignoredByBundle, repaired: plan.totalActions };
};

export const createHealer = (kit: MinecraftKit, deps: CreateHealerDeps): Healer => ({
  healAfterDeletes: async (slug, bundleOwnedPaths, options) => {
    try {
      const { target, clientFolder } = await deps.resolveContext(slug);
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
