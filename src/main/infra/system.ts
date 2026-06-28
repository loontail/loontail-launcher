import type { Dirent } from 'node:fs';
import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
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

export const getDiskSpace = async (path: string): Promise<DiskInfo> => {
  if (!path) return { path, error: true };
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
    return { path, error: true };
  }
};

// Cap concurrent fs ops on libuv: a Minecraft install can hold tens of
// thousands of files, and unbounded Promise.all would queue every stat at
// once and starve other main-process fs/dns work behind a busy thread pool.
const WALK_CONCURRENCY = 16;

const walkDirectorySize = async (root: string): Promise<number> => {
  let total = 0;
  const limit = createLimiter(WALK_CONCURRENCY);
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await limit(() => readdir(dir, { withFileTypes: true }));
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const info = await limit(() => stat(full));
            total += info.size;
          } catch {}
        }
      }),
    );
  };
  await walk(root);
  return total;
};

export const getFolderSize = async (path: string): Promise<FolderSize> => {
  if (!path) return { path, bytes: null };
  try {
    await stat(path);
  } catch {
    return { path, bytes: null };
  }
  try {
    const bytes = await walkDirectorySize(path);
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
  const space = await getDiskSpace(finalPath);
  return {
    path: finalPath,
    ...(space.diskPath !== undefined ? { diskPath: space.diskPath } : {}),
    ...(space.free !== undefined ? { free: space.free } : {}),
    ...(space.size !== undefined ? { size: space.size } : {}),
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

  const canonicalRoots = (
    await Promise.all(allowedRoots.filter(Boolean).map((root) => canonicalizePath(root)))
  ).filter((root): root is string => root !== null);

  const isAllowed = canonicalRoots.some((root) => isSameOrDescendantPath(root, canonicalTarget));
  if (!isAllowed) {
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
