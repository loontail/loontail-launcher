import type { LocalManifest, RemoteManifest } from '@shared/contracts/bundle';
import { normalizePathForSet } from './paths';

export const flattenRemote = (manifest: RemoteManifest): Pick<LocalManifest, 'files'> => {
  const files: LocalManifest['files'] = {};
  for (const entries of Object.values(manifest)) {
    for (const entry of entries) {
      if (entry.isDir) continue;
      if (!entry.sha256) continue;
      files[normalizePathForSet(entry.path)] = { sha256: entry.sha256, size: entry.size };
    }
  }
  return { files };
};
