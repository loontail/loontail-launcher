import path from 'node:path';
import type {
  MinecraftKit,
  ProgressListener,
  RepairIssueFilter,
  VerificationResult,
} from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import type { ClientSlug } from '@shared/contracts/ids';
import { buildContext } from './context';

const logger = scopedLogger('bundle.heal');

export type HealOutcome = {
  // Files the bundle currently owns — never repaired even if kit verify flags
  // them as wrong-sha1 (the bundle deliberately overrides vanilla).
  ignoredByBundle: number;
  // Files outside the bundle's ownership that we actually re-downloaded.
  repaired: number;
  // True when the underlying verify call ran successfully (regardless of
  // whether a repair was needed).
  verifyCompleted: boolean;
};

// Bundle paths come from the manifest in forward-slash form; convert disk
// paths to the same normalisation so set membership is deterministic.
const toBundleKey = (clientFolder: string, absPath: string): string =>
  path.relative(clientFolder, absPath).replace(/\\/g, '/');

const isBundleOwnedIssue = (
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
  issuePath: string,
): boolean => bundleOwnedPaths.has(toBundleKey(clientFolder, issuePath));

type VerifyAndRepairOptions = {
  signal?: AbortSignal;
  // Forwarded to both `kit.verify.minecraft.run` and `kit.repair.minecraft.run`
  // so callers can surface live progress (verify file counts + repair bytes).
  onEvent?: ProgressListener;
};

const opOptions = (
  options: VerifyAndRepairOptions | undefined,
): { signal?: AbortSignal; onEvent?: ProgressListener } => ({
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
});

export const createBundleRepairIssueFilter =
  (clientFolder: string, bundleOwnedPaths: ReadonlySet<string>): RepairIssueFilter =>
  ({ issue }) =>
    !isBundleOwnedIssue(clientFolder, bundleOwnedPaths, issue.path);

const countBundleOwnedIssues = (
  result: VerificationResult,
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
): number =>
  result.issues.filter((issue) => isBundleOwnedIssue(clientFolder, bundleOwnedPaths, issue.path))
    .length;

// Run kit.verify.minecraft, drop any issues for paths the bundle owns, then
// repair only what's left. No-op when the filtered set is empty.
export const verifyAndRepairExceptBundle = async (
  kit: MinecraftKit,
  slug: ClientSlug,
  bundleOwnedPaths: ReadonlySet<string>,
  options?: VerifyAndRepairOptions,
): Promise<HealOutcome> => {
  const ctx = await buildContext(kit, slug);
  const result = await kit.verify.minecraft.run(ctx.target, opOptions(options));
  const shouldRepairIssue = createBundleRepairIssueFilter(ctx.clientFolder, bundleOwnedPaths);
  const ignoredByBundle = countBundleOwnedIssues(result, ctx.clientFolder, bundleOwnedPaths);
  const repairableIssues = result.issues.length - ignoredByBundle;

  if (repairableIssues === 0) {
    logger.info(
      `[${slug}] heal: minecraft slice clean (verified=${result.checkedFiles}, ignored=${ignoredByBundle})`,
    );
    return { ignoredByBundle, repaired: 0, verifyCompleted: true };
  }

  logger.info(
    `[${slug}] heal: repairing ${repairableIssues} minecraft files (ignored ${ignoredByBundle} bundle-owned)`,
  );

  const plan = await kit.repair.minecraft.plan(ctx.target, {
    from: result,
    shouldRepairIssue,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (plan.totalActions > 0) {
    await kit.repair.minecraft.run(plan, opOptions(options));
  }

  return {
    ignoredByBundle,
    repaired: plan.totalActions,
    verifyCompleted: true,
  };
};
