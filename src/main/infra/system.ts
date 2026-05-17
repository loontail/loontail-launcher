import { type Dirent, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { basename, join } from 'node:path';
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
  if (range.length === 0) return 0;
  const cutoffIndex = Math.max(1, Math.floor(range.length / 3));
  const lower = range.slice(0, cutoffIndex);
  return Math.max(...lower);
};

export const ensureDirectory = (path: string): void => {
  if (!path) return;
  try {
    mkdirSync(path, { recursive: true });
  } catch (error) {
    logger.warn('Failed to create directory', { path, error });
  }
};

export const directoryHasEntries = (path: string): boolean => {
  if (!path || !existsSync(path)) return false;
  try {
    return readdirSync(path).length > 0;
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

const walkDirectorySize = async (root: string): Promise<number> => {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
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
            const info = await stat(full);
            total += info.size;
          } catch {
            // skip unreadable file
          }
        }
      }),
    );
  };
  await walk(root);
  return total;
};

export const getFolderSize = async (path: string): Promise<FolderSize> => {
  if (!path || !existsSync(path)) return { path, bytes: null };
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

export const openPath = async (targetPath: string): Promise<void> => {
  if (!targetPath) return;
  try {
    await shell.openPath(targetPath);
  } catch (error) {
    logger.warn('Failed to open path', { targetPath, error });
  }
};
