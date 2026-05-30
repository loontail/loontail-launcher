import type { RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';

// Single traversal contract for a RemoteManifest: walk every category list and
// drop directory markers. Callers add their own predicate (plan keeps every
// file, the snapshot keeps only files carrying a sha256).
export const flattenRemoteEntries = (manifest: RemoteManifest): RemoteManifestEntry[] => {
  const out: RemoteManifestEntry[] = [];
  for (const list of Object.values(manifest)) {
    for (const entry of list) {
      if (entry.isDir) continue;
      out.push(entry);
    }
  }
  return out;
};
