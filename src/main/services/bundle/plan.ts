import fs from 'node:fs/promises';
import { BUNDLE_DOWNLOAD_CONCURRENCY } from '@main/constants/bundle';
import { createLimiter } from '@main/infra/concurrency';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { LocalManifest, RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';
import { BundleError } from './errors';
import { sha256File } from './hash';
import { flattenRemoteEntries } from './manifestUtils';
import { normalizePathForSet, resolveSafeEntryPath, toComparisonKey } from './paths';

// Index a local manifest's files by their comparison key so lookups survive a
// casing drift between the remote manifest and what a prior sync recorded (see
// `toComparisonKey`). The stored keys keep their original casing for fs ops.
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
  // True for "Repair" mode: ignore local manifest fast-path, re-hash everything
  // on disk so we trust observed state, not cached state.
  force?: boolean;
  // Aborts classification: force mode re-hashes the whole bundle, so a cancel
  // (or a launch-target sync that the user stopped) must short-circuit instead
  // of running uncancellably to completion.
  signal?: AbortSignal;
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

type Verdict = 'download' | 'update' | 'skip';

const exists = async (absPath: string): Promise<boolean> => {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
};

// Decide a single entry's fate against local manifest + disk. Pure-ish (reads
// disk for force mode and the "no local record" branch, never mutates).
const classifyEntry = async (
  entry: RemoteManifestEntry,
  localFiles: Map<string, LocalFileRecord>,
  clientFolder: string,
  force: boolean,
): Promise<Verdict> => {
  const destPath = resolveSafeEntryPath(clientFolder, entry.path);
  const comparisonKey = toComparisonKey(entry.path);

  // downloadOnce: fire-and-forget files (installers, one-shot patches).
  // Never re-checked once placed.
  if (entry.downloadOnce) {
    return (await exists(destPath)) ? 'skip' : 'download';
  }

  // No sha256 → can't verify integrity; safest to always re-fetch unless
  // we've already accepted it in a previous successful sync.
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

  // Disk-hash fast path: only paid in force mode or when local manifest is
  // missing a record for a file that exists on disk.
  try {
    const onDiskHash = await sha256File(destPath);
    return onDiskHash === entry.sha256 ? 'skip' : 'update';
  } catch {
    // Read failed (race, perms, missing) — re-download.
    return 'download';
  }
};

// Build the diff between remote and local. Classifies entries with bounded
// concurrency, then assembles the buckets by walking the results in input
// order so the plan is deterministic regardless of which task settled first.
export const buildPlan = async (
  remote: RemoteManifest,
  local: LocalManifest | null,
  clientFolder: string,
  flags: PlanFlags = {},
): Promise<SyncPlan> => {
  const force = flags.force === true;
  const signal = flags.signal;
  const remoteEntries = flattenRemoteEntries(remote);
  // Healer-facing set keeps the storage casing: the healer compares it against
  // disk-derived paths (kit-verify issues) whose casing must be matched exactly
  // on case-sensitive platforms, so this set must not be case-folded.
  const bundleOwnedRelativePaths = new Set<string>(
    remoteEntries.map((e) => normalizePathForSet(e.path)),
  );
  // Separate case-insensitive (on Windows) membership set for the local-only
  // delete diff: a casing drift must not queue a still-remote-owned file for
  // deletion (BUG-4).
  const remoteComparisonKeys = new Set<string>(remoteEntries.map((e) => toComparisonKey(e.path)));
  const localFiles = indexLocalFiles(local);

  const limit = createLimiter(BUNDLE_DOWNLOAD_CONCURRENCY);
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

  // Local-only files that no longer appear in the remote → delete after the
  // download phase. Membership is tested case-insensitively (on Windows) so a
  // casing drift between manifests does not delete a still-owned file, but the
  // original-cased local key is what gets queued for the actual fs delete.
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
