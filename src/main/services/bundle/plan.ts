import fs from 'node:fs/promises';
import { BUNDLE_PLAN_HASH_CONCURRENCY } from '@main/constants/bundle';
import { createLimiter } from '@main/infra/concurrency';
import type { LocalManifest, RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { BundleError } from './errors';
import { sha256File } from './hash';
import { flattenRemoteEntries } from './manifestUtils';
import { normalizePathForSet, resolveSafeEntryPath, toComparisonKey } from './paths';

// Index local files by comparison key so lookups survive a casing drift (see
// `toComparisonKey`); stored records keep their original casing for fs ops.
type LocalFileRecord = LocalManifest['files'][string];
const indexLocalFiles = (local: LocalManifest | null): Map<string, LocalFileRecord> => {
  const index = new Map<string, LocalFileRecord>();
  if (!local) return index;
  for (const [key, record] of Object.entries(local.files)) {
    index.set(toComparisonKey(key), record);
  }
  return index;
};

export type PlanFlags = {
  // Repair mode: skip the manifest fast-path and re-hash disk, trusting observed
  // state over cached.
  force?: boolean;
  // Force mode re-hashes the whole bundle, so a cancel must short-circuit it.
  signal?: AbortSignal;
};

export type SyncPlan = {
  toDownload: RemoteManifestEntry[];
  toUpdate: RemoteManifestEntry[];
  toDelete: string[]; // relative paths from the previous local manifest
  toSkip: RemoteManifestEntry[];
  // Bundle-owned paths in the current remote manifest; the healer ignores verify
  // issues for these (the bundle deliberately overrides them).
  bundleOwnedRelativePaths: Set<string>;
  bytesTotal: number;
};

type Verdict = 'download' | 'update' | 'skip';

const exists = async (absPath: string): Promise<boolean> => {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
};

const classifyEntry = async (
  entry: RemoteManifestEntry,
  localFiles: Map<string, LocalFileRecord>,
  clientFolder: string,
  force: boolean,
): Promise<Verdict> => {
  const destPath = resolveSafeEntryPath(clientFolder, entry.path);
  const comparisonKey = toComparisonKey(entry.path);

  // downloadOnce: one-shot files (installers/patches), never re-checked once placed.
  if (entry.downloadOnce) {
    return (await exists(destPath)) ? 'skip' : 'download';
  }

  // No sha256 → can't verify; re-fetch unless a prior sync already accepted it.
  if (!entry.sha256) {
    const known = localFiles.get(comparisonKey);
    return !force && known && (await exists(destPath)) ? 'skip' : 'download';
  }

  if (!force) {
    const known = localFiles.get(comparisonKey);
    if (known && known.sha256 === entry.sha256 && (await exists(destPath))) {
      return 'skip';
    }
    if (!known) {
      if (!(await exists(destPath))) {
        return 'download';
      }
      // No record but file exists → fall through to disk hash.
    } else if (!(await exists(destPath))) {
      return 'download';
    }
  }

  try {
    const onDiskHash = await sha256File(destPath);
    return onDiskHash === entry.sha256 ? 'skip' : 'update';
  } catch {
    // Read failed (race, perms, missing) — re-download.
    return 'download';
  }
};

// Classify entries with bounded concurrency, then assemble buckets in input
// order so the plan is deterministic regardless of settle order.
export const buildPlan = async (
  remote: RemoteManifest,
  local: LocalManifest | null,
  clientFolder: string,
  flags: PlanFlags = {},
): Promise<SyncPlan> => {
  const force = flags.force === true;
  const signal = flags.signal;
  const remoteEntries = flattenRemoteEntries(remote);
  // Healer-facing set keeps storage casing: it's matched against disk-derived
  // paths exactly on case-sensitive platforms, so must not be case-folded.
  const bundleOwnedRelativePaths = new Set<string>(
    remoteEntries.map((e) => normalizePathForSet(e.path)),
  );
  // Case-folded (on Windows) set for the delete diff so a casing drift doesn't
  // queue a still-remote-owned file for deletion.
  const remoteComparisonKeys = new Set<string>(remoteEntries.map((e) => toComparisonKey(e.path)));
  const localFiles = indexLocalFiles(local);

  const limit = createLimiter(BUNDLE_PLAN_HASH_CONCURRENCY);
  const verdicts = await Promise.all(
    remoteEntries.map((entry) =>
      limit(async () => {
        if (signal?.aborted) {
          throw new BundleError(BundleErrorCodes.ABORTED, 'Bundle planning aborted');
        }
        return classifyEntry(entry, localFiles, clientFolder, force);
      }),
    ),
  );

  const toDownload: RemoteManifestEntry[] = [];
  const toUpdate: RemoteManifestEntry[] = [];
  const toSkip: RemoteManifestEntry[] = [];
  remoteEntries.forEach((entry, index) => {
    switch (verdicts[index]) {
      case 'download':
        toDownload.push(entry);
        break;
      case 'update':
        toUpdate.push(entry);
        break;
      default:
        toSkip.push(entry);
    }
  });

  // Local-only files absent from the remote → delete. The original-cased local
  // key is what gets queued for the fs delete.
  const toDelete: string[] = [];
  if (local) {
    for (const localPath of Object.keys(local.files)) {
      if (!remoteComparisonKeys.has(toComparisonKey(localPath))) {
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
