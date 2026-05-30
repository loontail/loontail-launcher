import type { LocalManifest, RemoteManifest } from '@shared/contracts/bundle';
import { flattenRemoteEntries } from './manifestUtils';
import { normalizePathForSet } from './paths';

export const flattenRemote = (manifest: RemoteManifest): Pick<LocalManifest, 'files'> => {
  const files: LocalManifest['files'] = {};
  for (const entry of flattenRemoteEntries(manifest)) {
    if (!entry.sha256) continue;
    files[normalizePathForSet(entry.path)] = { sha256: entry.sha256, size: entry.size };
  }
  return { files };
};
