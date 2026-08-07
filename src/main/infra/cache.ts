import type { Dirent, Stats } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
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

// Resolves false when the bytes did not land, so a caller that commits companion
// metadata separately can avoid describing a body it failed to write.
export const writeBuffer = async (
  namespace: string,
  key: string,
  buffer: Buffer,
): Promise<boolean> => {
  try {
    const dir = await ensureNamespace(namespace);
    const file = join(dir, safeKey(key));
    await writeFile(file, buffer);
    return true;
  } catch (error) {
    logger.warn('Failed to write cache entry', { namespace, key, error });
    return false;
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

const decodeKey = (fileName: string): string => Buffer.from(fileName, 'base64url').toString('utf8');

type EvictionGroup = { entries: NamespaceEntry[]; size: number; mtimeMs: number };

// Companion entries (a sidecar keyed `<key><suffix>`) are never evicted on their
// own: they carry the metadata their body needs, so the pair lives and dies
// together. A companion whose body is absent is a candidate orphan, dropped
// regardless of the size bound once it is older than ORPHAN_GRACE_MS.
const groupForEviction = (
  entries: readonly NamespaceEntry[],
  companionSuffix: string | undefined,
): { groups: EvictionGroup[]; orphans: NamespaceEntry[] } => {
  if (!companionSuffix) {
    return {
      groups: entries.map((entry) => ({
        entries: [entry],
        size: entry.size,
        mtimeMs: entry.mtimeMs,
      })),
      orphans: [],
    };
  }
  const byKey = new Map<string, NamespaceEntry>();
  const companions = new Map<string, NamespaceEntry>();
  for (const entry of entries) {
    const key = decodeKey(basename(entry.file));
    if (key.endsWith(companionSuffix)) {
      companions.set(key.slice(0, -companionSuffix.length), entry);
    } else {
      byKey.set(key, entry);
    }
  }
  const groups: EvictionGroup[] = [];
  for (const [key, body] of byKey) {
    const companion = companions.get(key);
    companions.delete(key);
    groups.push({
      entries: companion ? [body, companion] : [body],
      size: body.size + (companion?.size ?? 0),
      mtimeMs: body.mtimeMs,
    });
  }
  return { groups, orphans: [...companions.values()] };
};

// A body and its companion are written as two separate fs operations, so a
// companion with no body on disk may simply be waiting for one. Only a companion
// that has been sitting there longer than a write can plausibly take is an orphan;
// a younger one is left for the next pass.
const ORPHAN_GRACE_MS = 60_000;

// Eviction is best-effort housekeeping, not a critical path — errors are swallowed.
export const enforceSizeBound = async (
  namespace: string,
  maxBytes: number,
  options: { companionSuffix?: string } = {},
): Promise<void> => {
  if (maxBytes < 0) return;
  try {
    const startedAt = Date.now();
    const files = await listNamespaceFiles(namespaceDir(namespace));
    const { groups, orphans } = groupForEviction(files, options.companionSuffix);
    let total = files.reduce((sum, entry) => sum + entry.size, 0);
    const remove = async (entry: NamespaceEntry): Promise<void> => {
      try {
        await rm(entry.file, { force: true });
        total -= entry.size;
      } catch (error) {
        logger.warn('Failed to evict cache entry', { namespace, file: entry.file, error });
      }
    };
    for (const orphan of orphans) {
      if (startedAt - orphan.mtimeMs < ORPHAN_GRACE_MS) continue;
      await remove(orphan);
    }
    if (total <= maxBytes) return;
    groups.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const group of groups) {
      if (total <= maxBytes) break;
      for (const entry of group.entries) await remove(entry);
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
  // Validates a snapshot read back from disk. The fetcher's own result is already
  // schema-checked upstream, but a snapshot is untrusted input: it survives across
  // releases (so it can predate a shape change) and lives in a user-writable file.
  // Without this the offline path hands the caller whatever JSON it finds, typed as
  // T — a stale object then reaches code expecting an array and throws far from here.
  parseSnapshot?: (value: unknown) => T | null;
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
    const snapshot = readSnapshot<T>(cached, options);
    if (snapshot === null) throw error;
    return snapshot;
  }
};

const readSnapshot = <T>(cached: Buffer, options: CachedFetchOptions<T>): T | null => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(cached.toString('utf8'));
  } catch (parseError) {
    logger.warn('Corrupt cache entry; rethrowing fetcher error', {
      namespace: options.namespace,
      key: options.key,
      parseError,
    });
    return null;
  }
  if (!options.parseSnapshot) return decoded as T;
  const parsed = options.parseSnapshot(decoded);
  if (parsed === null) {
    logger.warn('Cache entry does not match the expected shape; rethrowing fetcher error', {
      namespace: options.namespace,
      key: options.key,
    });
  }
  return parsed;
};
