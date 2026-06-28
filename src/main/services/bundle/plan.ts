import fs from 'node:fs/promises';
import { BUNDLE_DOWNLOAD_CONCURRENCY } from '@main/constants/bundle';
import { createLimiter } from '@main/infra/concurrency';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { LocalManifest, RemoteManifest, RemoteManifestEntry } from '@shared/contracts/bundle';
import { BundleError } from './errors';
import { sha256File } from './hash';
import { flattenRemoteEntries } from './manifestUtils';
import { normalizePathForSet, resolveSafeEntryPath } from './paths';

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
  local: LocalManifest | null,
  clientFolder: string,
  force: boolean,
): Promise<Verdict> => {
  const destPath = resolveSafeEntryPath(clientFolder, entry.path);
  const normalizedKey = normalizePathForSet(entry.path);

  // downloadOnce: fire-and-forget files (installers, one-shot patches).
  // Never re-checked once placed.
  if (entry.downloadOnce) {
    return (await exists(destPath)) ? 'skip' : 'download';
  }

  // No sha256 → can't verify integrity; safest to always re-fetch unless
  // we've already accepted it in a previous successful sync.
  if (!entry.sha256) {
    const known = local?.files[normalizedKey];
    return !force && known && (await exists(destPath)) ? 'skip' : 'download';
  }

  if (!force) {
    const known = local?.files[normalizedKey];
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
  const bundleOwnedRelativePaths = new Set<string>(
    remoteEntries.map((e) => normalizePathForSet(e.path)),
  );

  const limit = createLimiter(BUNDLE_DOWNLOAD_CONCURRENCY);
  const verdicts = await Promise.all(
    remoteEntries.map((entry) =>
      limit(async () => {
        if (signal?.aborted) {
          throw new BundleError(BundleErrorCodes.ABORTED, 'Bundle planning aborted');
        }
        return classifyEntry(entry, local, clientFolder, force);
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
