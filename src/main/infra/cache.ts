import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { scopedLogger } from './logger';

const logger = scopedLogger('cache');

const safeKey = (key: string): string => Buffer.from(key, 'utf8').toString('base64url');

const namespaceDir = (namespace: string): string =>
  join(app.getPath('userData'), 'cache', namespace);

const ensureNamespace = (namespace: string): string => {
  const dir = namespaceDir(namespace);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const readBuffer = (namespace: string, key: string): Buffer | null => {
  const dir = namespaceDir(namespace);
  const file = join(dir, safeKey(key));
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file);
  } catch (error) {
    logger.warn('Failed to read cache entry', { namespace, key, error });
    return null;
  }
};

export const writeBuffer = (namespace: string, key: string, buffer: Buffer): void => {
  const dir = ensureNamespace(namespace);
  const file = join(dir, safeKey(key));
  try {
    writeFileSync(file, buffer);
  } catch (error) {
    logger.warn('Failed to write cache entry', { namespace, key, error });
  }
};

export const deleteBuffer = (namespace: string, key: string): void => {
  const dir = namespaceDir(namespace);
  const file = join(dir, safeKey(key));
  if (!existsSync(file)) return;
  try {
    rmSync(file);
  } catch (error) {
    logger.warn('Failed to delete cache entry', { namespace, key, error });
  }
};

export const clearNamespace = (namespace: string): void => {
  const dir = namespaceDir(namespace);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to clear cache namespace', { namespace, error });
  }
};
