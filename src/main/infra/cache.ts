import type { Dirent, Stats } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { HttpError } from './http';
import { scopedLogger } from './logger';

const logger = scopedLogger('cache');

const safeKey = (key: string): string => Buffer.from(key, 'utf8').toString('base64url');

const namespaceDir = (namespace: string): string =>
  join(app.getPath('userData'), 'cache', namespace);

const ensureNamespace = async (namespace: string): Promise<string> => {
  const dir = namespaceDir(namespace);
  await mkdir(dir, { recursive: true });
  return dir;
};

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';

export const readBuffer = async (namespace: string, key: string): Promise<Buffer | null> => {
  const dir = namespaceDir(namespace);
  const file = join(dir, safeKey(key));
  try {
    return await readFile(file);
  } catch (error) {
    if (isEnoent(error)) return null;
    logger.warn('Failed to read cache entry', { namespace, key, error });
    return null;
  }
};

export const writeBuffer = async (
  namespace: string,
  key: string,
  buffer: Buffer,
): Promise<void> => {
  try {
    const dir = await ensureNamespace(namespace);
    const file = join(dir, safeKey(key));
    await writeFile(file, buffer);
  } catch (error) {
    logger.warn('Failed to write cache entry', { namespace, key, error });
  }
};

export const deleteBuffer = async (namespace: string, key: string): Promise<void> => {
  const dir = namespaceDir(namespace);
  const file = join(dir, safeKey(key));
  try {
    await rm(file, { force: true });
  } catch (error) {
    logger.warn('Failed to delete cache entry', { namespace, key, error });
  }
};

export const clearNamespace = async (namespace: string): Promise<void> => {
  const dir = namespaceDir(namespace);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to clear cache namespace', { namespace, error });
  }
};

type NamespaceEntry = { file: string; size: number; mtimeMs: number };

const listNamespaceFiles = async (dir: string): Promise<NamespaceEntry[]> => {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const stats = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry): Promise<NamespaceEntry | null> => {
        const file = join(dir, entry.name);
        let info: Stats;
        try {
          info = await stat(file);
        } catch (error) {
          // Entry can vanish between readdir and stat (concurrent eviction) — skip.
          if (isEnoent(error)) return null;
          throw error;
        }
        return { file, size: info.size, mtimeMs: info.mtimeMs };
      }),
  );
  return stats.filter((entry): entry is NamespaceEntry => entry !== null);
};

export const getNamespaceSize = async (namespace: string): Promise<number> => {
  try {
    const files = await listNamespaceFiles(namespaceDir(namespace));
    return files.reduce((sum, entry) => sum + entry.size, 0);
  } catch (error) {
    logger.warn('Failed to compute cache namespace size', { namespace, error });
    return 0;
  }
};

// Eviction is best-effort housekeeping, not a critical path — errors are swallowed.
export const enforceSizeBound = async (namespace: string, maxBytes: number): Promise<void> => {
  if (maxBytes < 0) return;
  try {
    const files = await listNamespaceFiles(namespaceDir(namespace));
    let total = files.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= maxBytes) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of files) {
      if (total <= maxBytes) break;
      try {
        await rm(entry.file, { force: true });
        total -= entry.size;
      } catch (error) {
        logger.warn('Failed to evict cache entry', { namespace, file: entry.file, error });
      }
    }
  } catch (error) {
    logger.warn('Failed to enforce cache size bound', { namespace, error });
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

export const cachedFetch = async <T>(options: CachedFetchOptions<T>): Promise<T> => {
  const isOffline = options.isOfflineError ?? defaultIsOfflineError;
  try {
    const value = await options.fetcher();
    await writeBuffer(options.namespace, options.key, Buffer.from(JSON.stringify(value), 'utf8'));
    return value;
  } catch (error) {
    if (!isOffline(error)) throw error;
    const cached = await readBuffer(options.namespace, options.key);
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
