import path from 'node:path';
import type { RepairIssueFilter } from '@loontail/minecraft-kit';
import { loadLocalManifest } from './manifestRepo';

// Manifest paths are forward-slash; normalise disk paths the same way so set
// membership is deterministic.
export const toBundleKey = (clientFolder: string, absPath: string): string =>
  path.relative(clientFolder, absPath).replace(/\\/g, '/');

export const isBundleOwnedIssue = (
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
  issuePath: string,
): boolean => bundleOwnedPaths.has(toBundleKey(clientFolder, issuePath));

export const createBundleRepairIssueFilter =
  (clientFolder: string, bundleOwnedPaths: ReadonlySet<string>): RepairIssueFilter =>
  ({ issue }) =>
    !isBundleOwnedIssue(clientFolder, bundleOwnedPaths, issue.path);

// Paths the on-disk bundle manifest claims, or null when the folder has no
// manifest or it belongs to a different bundle. Local counterpart to plan.ts's
// remote-derived set of the same name.
export const bundleOwnedRelativePaths = async (
  clientFolder: string,
  expectedBundleSlug: string,
): Promise<ReadonlySet<string> | null> => {
  const manifest = await loadLocalManifest(clientFolder);
  if (manifest?.bundleSlug !== expectedBundleSlug) return null;
  return new Set(Object.keys(manifest.files));
};

// Injection point so the minecraft service can filter kit.repair.all by
// bundle-owned paths without statically importing the bundle service. Returns
// null when there is nothing to protect.
export const resolveBundleRepairFilter = async (
  clientFolder: string,
  expectedBundleSlug: string,
): Promise<RepairIssueFilter | null> => {
  const owned = await bundleOwnedRelativePaths(clientFolder, expectedBundleSlug);
  if (owned === null) return null;
  return createBundleRepairIssueFilter(clientFolder, owned);
};
