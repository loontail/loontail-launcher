import path from 'node:path';
import { SIDECAR_DIR } from '@main/constants/paths';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

const BUNDLE_MANIFEST_FILE = 'bundle.json';

export const bundleManifestPath = (clientFolder: string): string =>
  path.join(clientFolder, SIDECAR_DIR, BUNDLE_MANIFEST_FILE);

// Reject anything escaping the client folder (absolute paths, `..`, Windows
// drive letters) so a crafted manifest entry can't write outside the install.
export const resolveSafeEntryPath = (clientFolder: string, entryPath: string): string => {
  if (!entryPath || typeof entryPath !== 'string') {
    throw new BundleError(BundleErrorCodes.UNSAFE_PATH, 'Empty entry path');
  }
  // Reject before resolve() silently re-roots a drive-letter path against the drive.
  if (path.isAbsolute(entryPath) || /^[a-zA-Z]:/.test(entryPath)) {
    throw new BundleError(
      BundleErrorCodes.UNSAFE_PATH,
      `Absolute entry path is not allowed: ${entryPath}`,
    );
  }
  const normalizedRoot = path.resolve(clientFolder);
  const resolved = path.resolve(normalizedRoot, entryPath);
  const rel = path.relative(normalizedRoot, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new BundleError(
      BundleErrorCodes.UNSAFE_PATH,
      `Entry escapes the client folder: ${entryPath}`,
    );
  }
  return resolved;
};

export const isAncestor = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Storage form for local-manifest keys and the bundle-owned set; preserves
// casing, which the fs path must keep.
export const normalizePathForSet = (p: string): string => p.replace(/\\/g, '/');

// Case-folded (on Windows) comparison key for membership/lookup ONLY: a casing
// drift between manifests (e.g. `Mods/x.jar` vs `mods/x.jar`) must resolve to
// the same file, else a still-owned file is queued for deletion and heal churns.
// The original-cased path is kept for the fs operation.
export const toComparisonKey = (p: string): string => {
  const normalized = normalizePathForSet(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
