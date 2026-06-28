import path from 'node:path';
import type { RepairIssueFilter } from '@loontail/minecraft-kit';
import { loadLocalManifest } from './manifestRepo';

// Bundle paths come from the manifest in forward-slash form; convert disk
// paths to the same normalisation so set membership is deterministic.
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

// LOCAL-manifest ownership: the set of paths the on-disk bundle manifest claims,
// or null when the folder has no manifest or the manifest belongs to a different
// bundle. This is the persisted/local counterpart to plan.ts's remote-derived
// bundleOwnedRelativePaths — same name, different input, both kept.
export const bundleOwnedRelativePaths = async (
  clientFolder: string,
  expectedBundleSlug: string,
): Promise<ReadonlySet<string> | null> => {
  const manifest = await loadLocalManifest(clientFolder);
  if (manifest?.bundleSlug !== expectedBundleSlug) return null;
  return new Set(Object.keys(manifest.files));
};

// Neutral injection point for the minecraft repair path: resolve the local
// bundle ownership and return a kit RepairIssueFilter that skips bundle-owned
// paths, or null when there is nothing to protect. Lets the minecraft service
// filter kit.repair.all without statically importing the bundle service.
export const resolveBundleRepairFilter = async (
  clientFolder: string,
  expectedBundleSlug: string,
): Promise<RepairIssueFilter | null> => {
  const owned = await bundleOwnedRelativePaths(clientFolder, expectedBundleSlug);
  if (owned === null) return null;
  return createBundleRepairIssueFilter(clientFolder, owned);
};
