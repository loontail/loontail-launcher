import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { scopedLogger } from '@main/infra/logger';
import { RAM_STEP_MB } from '@shared/constants';
import type { DiskInfo, PickedFolder } from '@shared/contracts/system';
import { type BrowserWindow, dialog, shell } from 'electron';

const BYTES_PER_MB = 1024 * 1024;
const MIN_RAM_MB = 1024;

const logger = scopedLogger('system');

export const getRamRange = (): number[] => {
  const totalMb = Math.floor(totalmem() / BYTES_PER_MB);
  const range: number[] = [];
  for (let value = MIN_RAM_MB; value <= totalMb; value += RAM_STEP_MB) {
    range.push(value);
  }
  if (range.length === 0) range.push(MIN_RAM_MB);
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
