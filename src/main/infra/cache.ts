import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { HttpError } from './http';
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

// HTTP 4xx is a valid server response (auth/not-found/etc.) — pass it through.
// Anything else (network / DNS / timeout / abort / 5xx) means the API is unreachable.
const defaultIsOfflineError = (error: unknown): boolean => {
  if (error instanceof HttpError) return error.status >= 500;
  return true;
};

export type CachedFetchOptions<T> = {
  namespace: string;
  key: string;
  fetcher: () => Promise<T>;
  isOfflineError?: (error: unknown) => boolean;
};

/**
 * Network-first JSON cache with on-disk fallback.
 *
 * Online: call `fetcher`, persist its JSON to disk, return the live value.
 * Offline (network/5xx by default): return the last persisted JSON from disk.
 * If the API returned 4xx, or disk has no snapshot, the original error is rethrown.
 */
export const cachedFetch = async <T>(options: CachedFetchOptions<T>): Promise<T> => {
  const isOffline = options.isOfflineError ?? defaultIsOfflineError;
  try {
    const value = await options.fetcher();
    writeBuffer(options.namespace, options.key, Buffer.from(JSON.stringify(value), 'utf8'));
    return value;
  } catch (error) {
    if (!isOffline(error)) throw error;
    const cached = readBuffer(options.namespace, options.key);
    if (!cached) throw error;
    try {
      return JSON.parse(cached.toString('utf8')) as T;
    } catch (parseError) {
      logger.warn('Corrupt cache entry; rethrowing fetcher error', {
        namespace: options.namespace,
        key: options.key,
        parseError,
      });
      throw error;
    }
  }
};
