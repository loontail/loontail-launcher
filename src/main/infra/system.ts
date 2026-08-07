import type { Dirent } from 'node:fs';
import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createLimiter } from '@main/infra/concurrency';
import { scopedLogger } from '@main/infra/logger';
import { RAM_MIN_MB, RAM_STEP_MB } from '@shared/constants';
import type { DiskInfo, FolderSize, PickedFolder } from '@shared/contracts/system';
import { type BrowserWindow, dialog, shell } from 'electron';

const BYTES_PER_MB = 1024 * 1024;

const logger = scopedLogger('system');

export const getRamRange = (): number[] => {
  const totalMb = Math.floor(totalmem() / BYTES_PER_MB);
  const range: number[] = [];
  for (let value = RAM_MIN_MB; value <= totalMb; value += RAM_STEP_MB) {
    range.push(value);
  }
  if (range.length === 0) range.push(RAM_MIN_MB);
  return range;
};

export const computeDefaultRamMb = (): number => {
  const range = getRamRange();
  const cutoffIndex = Math.max(1, Math.floor(range.length / 3));
  const lower = range.slice(0, cutoffIndex);
  return Math.max(...lower);
};

export const ensureDirectory = async (path: string): Promise<void> => {
  if (!path) return;
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    logger.warn('Failed to create directory', { path, error });
  }
};

export const directoryHasEntries = async (path: string): Promise<boolean> => {
  if (!path) return false;
  try {
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
};

// Null (not a half-empty DiskInfo) when the probe cannot answer, so the route
// layer owns how a failure crosses the bridge and infra stays protocol-free.
export const getDiskSpace = async (path: string): Promise<DiskInfo | null> => {
  if (!path) return null;
  try {
    const checkDiskSpace = (await import('check-disk-space')).default;
    const info = await checkDiskSpace(path);
    return {
      path,
      diskPath: info.diskPath,
      free: info.free,
      size: info.size,
    };
  } catch (error) {
    logger.warn('Failed to read disk space', { path, error });
    return null;
  }
};

// Cap concurrent fs ops: a Minecraft install holds tens of thousands of files,
// and unbounded Promise.all would starve other main-process work behind a busy
// libuv pool. The limiter is process-wide, not per walk: a per-walk one let N
// concurrent getFolderSize calls each open their own 16-way fan-out.
const WALK_CONCURRENCY = 16;

const walkLimit = createLimiter(WALK_CONCURRENCY);

// The walk is reachable from the renderer, so it must terminate on a pathological
// tree (a deep junction farm, a network mount) instead of pinning the libuv pool
// for minutes and starving installs/launches. Both bounds return the partial
// total rather than an error: a slightly low folder size is a cosmetic loss.
export type FolderWalkLimits = { maxEntries: number; timeoutMs: number };

const DEFAULT_WALK_LIMITS: FolderWalkLimits = { maxEntries: 500_000, timeoutMs: 30_000 };

const walkDirectorySize = async (root: string, limits: FolderWalkLimits): Promise<number> => {
  let total = 0;
  let entriesSeen = 0;
  let stopped = false;
  // Monotonic so a wall-clock jump can neither abort early nor extend the bound.
  const deadline = performance.now() + limits.timeoutMs;
  const stopReason = (): string | null => {
    if (entriesSeen >= limits.maxEntries) return 'entry cap';
    if (performance.now() >= deadline) return 'timeout';
    return null;
  };
  const shouldStop = (): boolean => {
    if (stopped) return true;
    const reason = stopReason();
    if (reason === null) return false;
    stopped = true;
    logger.warn('Folder size walk stopped early; reporting a partial total', {
      root,
      reason,
      entriesSeen,
    });
    return true;
  };
  const walk = async (dir: string): Promise<void> => {
    if (shouldStop()) return;
    let entries: Dirent[];
    try {
      entries = await walkLimit(() => readdir(dir, { withFileTypes: true }));
    } catch {
      return;
    }
    entriesSeen += entries.length;
    await Promise.all(
      entries.map(async (entry) => {
        if (shouldStop()) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const info = await walkLimit(() => stat(full));
            total += info.size;
          } catch {}
        }
      }),
    );
  };
  await walk(root);
  return total;
};

export const getFolderSize = async (
  path: string,
  limits: FolderWalkLimits = DEFAULT_WALK_LIMITS,
): Promise<FolderSize> => {
  if (!path) return { path, bytes: null };
  try {
    await stat(path);
  } catch {
    return { path, bytes: null };
  }
  try {
    const bytes = await walkDirectorySize(path, limits);
    return { path, bytes };
  } catch (error) {
    logger.warn('Failed to compute folder size', { path, error });
    return { path, bytes: null };
  }
};

export const pickFolderWithSuffix = async (
  window: BrowserWindow,
  suffix: string | null,
): Promise<PickedFolder | null> => {
  if (window.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  const candidatePath = result.filePaths[0];
  if (!candidatePath) return null;
  const finalPath =
    suffix && basename(candidatePath) !== suffix ? join(candidatePath, suffix) : candidatePath;
  // A failed probe still yields a usable pick: the caller only needs the path.
  const space = await getDiskSpace(finalPath);
  return {
    path: finalPath,
    ...(space ? { diskPath: space.diskPath, free: space.free, size: space.size } : {}),
  };
};

const comparablePath = (targetPath: string): string =>
  process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;

const isSameOrDescendantPath = (root: string, targetPath: string): boolean => {
  const normalizedRoot = comparablePath(resolve(root));
  const normalizedTarget = comparablePath(resolve(targetPath));
  const rel = relative(normalizedRoot, normalizedTarget);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const canonicalizePath = async (targetPath: string): Promise<string | null> => {
  try {
    return await realpath(targetPath);
  } catch {
    return null;
  }
};

// A folder the user is about to create has no realpath yet (the Settings/Setup UI
// legitimately asks for its free space), so canonicalize the nearest existing
// ancestor and re-attach the missing tail — segments that do not exist cannot be
// symlinks, so the result is still escape-proof.
const canonicalizeExistingPrefix = async (targetPath: string): Promise<string | null> => {
  let current = resolve(targetPath);
  const missingTail: string[] = [];
  for (;;) {
    const real = await canonicalizePath(current);
    if (real !== null) {
      return missingTail.length === 0 ? real : join(real, ...missingTail);
    }
    const parent = dirname(current);
    if (parent === current) return null;
    missingTail.unshift(basename(current));
    current = parent;
  }
};

const isCanonicalTargetAllowed = async (
  canonicalTarget: string,
  allowedRoots: readonly string[],
): Promise<boolean> => {
  const canonicalRoots = (
    await Promise.all(allowedRoots.filter(Boolean).map((root) => canonicalizePath(root)))
  ).filter((root): root is string => root !== null);
  return canonicalRoots.some((root) => isSameOrDescendantPath(root, canonicalTarget));
};

// Gate for every renderer-supplied path that reaches the filesystem. Returns a
// boolean (not a throw) so a route can answer with its benign "unavailable"
// shape and keep the Settings UI rendering.
export const isPathUnderAllowedRoots = async (
  targetPath: string,
  allowedRoots: readonly string[],
): Promise<boolean> => {
  if (!targetPath) return false;
  const canonicalTarget = await canonicalizeExistingPrefix(targetPath);
  if (canonicalTarget === null) return false;
  return isCanonicalTargetAllowed(canonicalTarget, allowedRoots);
};

export const openPath = async (
  targetPath: string,
  allowedRoots: readonly string[],
): Promise<void> => {
  if (!targetPath) return;
  const canonicalTarget = await canonicalizePath(targetPath);
  if (!canonicalTarget) {
    logger.warn('Refused to open unavailable path', { targetPath });
    return;
  }

  if (!(await isCanonicalTargetAllowed(canonicalTarget, allowedRoots))) {
    logger.warn('Refused to open path outside launcher-owned roots', {
      targetPath,
      canonicalTarget,
    });
    return;
  }

  try {
    const errorMessage = await shell.openPath(canonicalTarget);
    if (errorMessage)
      logger.warn('Failed to open path', { targetPath: canonicalTarget, errorMessage });
  } catch (error) {
    logger.warn('Failed to open path', { targetPath: canonicalTarget, error });
  }
};
