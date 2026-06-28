import path from 'node:path';
import { SIDECAR_DIR } from '@main/constants/paths';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';

const BUNDLE_MANIFEST_FILE = 'bundle.json';

// Resolve where the local bundle manifest lives for a given client install.
export const bundleManifestPath = (clientFolder: string): string =>
  path.join(clientFolder, SIDECAR_DIR, BUNDLE_MANIFEST_FILE);

// Reject anything that escapes the client folder (absolute paths, `..`
// segments, drive letters on Windows). Returns the resolved absolute path on
// success.
export const resolveSafeEntryPath = (clientFolder: string, entryPath: string): string => {
  if (!entryPath || typeof entryPath !== 'string') {
    throw new BundleError(BundleErrorCodes.UNSAFE_PATH, 'Empty entry path');
  }
  // Reject absolute paths and Windows drive letters before resolve() silently
  // re-roots them against the drive.
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

// Used after a file delete to clean up any directories that became empty up to
// (but not including) the client folder root.
export const isAncestor = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Normalize for cross-platform set membership (Windows backslashes → forward).
// This is the *storage* form used for local-manifest keys and the bundle-owned
// set — it preserves the original casing, which the actual fs path must keep.
export const normalizePathForSet = (p: string): string => p.replace(/\\/g, '/');

// Comparison key for set membership and local-manifest lookup ONLY. On Windows
// the filesystem is case-insensitive, so a remote manifest emitting a different
// casing than a prior local manifest recorded (e.g. `Mods/x.jar` vs
// `mods/x.jar`) must still be treated as the same file — otherwise a still-owned
// file is queued for deletion and the heal pass churns. The original-cased path
// is always kept for the fs operation itself.
export const toComparisonKey = (p: string): string => {
  const normalized = normalizePathForSet(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
