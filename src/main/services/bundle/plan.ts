import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { LocalManifest, RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';
import { normalizePathForSet, resolveSafeEntryPath } from './paths';

export type PlanFlags = {
  // True for "Repair" mode: ignore local manifest fast-path, re-hash everything
  // on disk so we trust observed state, not cached state.
  force?: boolean;
};

export type SyncPlan = {
  toDownload: RemoteManifestEntry[];
  toUpdate: RemoteManifestEntry[];
  toDelete: string[]; // relative paths from the previous local manifest
  toSkip: RemoteManifestEntry[];
  // Bundle-owned paths in the *current remote* manifest. Healer uses this to
  // know which kit verify issues to ignore (bundle deliberately overrides them).
  bundleOwnedRelativePaths: Set<string>;
  // Progress-bar denominator.
  bytesTotal: number;
};

const flattenEntries = (manifest: RemoteManifest): RemoteManifestEntry[] => {
  const out: RemoteManifestEntry[] = [];
  for (const list of Object.values(manifest)) {
    for (const entry of list) {
      if (entry.isDir) continue;
      out.push(entry);
    }
  }
  return out;
};

const hashFile = (absPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const exists = async (absPath: string): Promise<boolean> => {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
};

// Build the diff between remote and local. Pure-ish (touches disk for force
// mode and the "no local record" branch, but never mutates anything). Returns
// classification + the set of paths the bundle owns post-sync.
export const buildPlan = async (
  remote: RemoteManifest,
  local: LocalManifest | null,
  clientFolder: string,
  flags: PlanFlags = {},
): Promise<SyncPlan> => {
  const force = flags.force === true;
  const remoteEntries = flattenEntries(remote);
  const bundleOwnedRelativePaths = new Set<string>(
    remoteEntries.map((e) => normalizePathForSet(e.path)),
  );

  const toDownload: RemoteManifestEntry[] = [];
  const toUpdate: RemoteManifestEntry[] = [];
  const toSkip: RemoteManifestEntry[] = [];

  for (const entry of remoteEntries) {
    const destPath = resolveSafeEntryPath(clientFolder, entry.path);
    const normalizedKey = normalizePathForSet(entry.path);

    // downloadOnce: fire-and-forget files (installers, one-shot patches).
    // Never re-checked once placed.
    if (entry.downloadOnce) {
      if (await exists(destPath)) {
        toSkip.push(entry);
      } else {
        toDownload.push(entry);
      }
      continue;
    }

    // No sha256 → can't verify integrity; safest to always re-fetch unless
    // we've already accepted it in a previous successful sync.
    if (!entry.sha256) {
      const known = local?.files[normalizedKey];
      if (!force && known && (await exists(destPath))) {
        toSkip.push(entry);
      } else {
        toDownload.push(entry);
      }
      continue;
    }

    if (!force) {
      const known = local?.files[normalizedKey];
      if (known && known.sha256 === entry.sha256 && (await exists(destPath))) {
        toSkip.push(entry);
        continue;
      }
      if (!known) {
        if (!(await exists(destPath))) {
          toDownload.push(entry);
          continue;
        }
        // No record but file exists → fall through to disk hash.
      } else if (!(await exists(destPath))) {
        toDownload.push(entry);
        continue;
      }
    }

    // Disk-hash fast path: only paid in force mode or when local manifest is
    // missing a record for a file that exists on disk.
    try {
      const onDiskHash = await hashFile(destPath);
      if (onDiskHash === entry.sha256) {
        toSkip.push(entry);
      } else {
        toUpdate.push(entry);
      }
    } catch {
      // Read failed (race, perms, missing) — re-download.
      toDownload.push(entry);
    }
  }

  // Local-only files that no longer appear in the remote → delete after the
  // download phase.
  const toDelete: string[] = [];
  if (local) {
    for (const localPath of Object.keys(local.files)) {
      if (!bundleOwnedRelativePaths.has(localPath)) {
        toDelete.push(localPath);
      }
    }
  }

  const bytesTotal =
    [...toDownload, ...toUpdate].reduce((sum, e) => sum + (e.size > 0 ? e.size : 0), 0) || 0;

  return {
    toDownload,
    toUpdate,
    toDelete,
    toSkip,
    bundleOwnedRelativePaths,
    bytesTotal,
  };
};
