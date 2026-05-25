import { createHash } from 'node:crypto';
import {
  clearNamespace,
  deleteBuffer,
  enforceSizeBound,
  getNamespaceSize,
  readBuffer,
  writeBuffer,
} from '@main/infra/cache';
import { scopedLogger } from '@main/infra/logger';

const CACHE_NAMESPACE = 'media';

// Cap the on-disk media cache so months of Strapi-image churn don't accrete
// a multi-GB footprint. LRU pruning runs after every cache write.
export const MEDIA_CACHE_MAX_BYTES = 200 * 1024 * 1024;

const logger = scopedLogger('media-cache');

type CachedMedia = { body: Buffer; mimeType: string };

const hashUrl = (url: string): string => createHash('sha1').update(url).digest('hex');

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

const guessMimeFromUrl = (url: string): string => {
  const withoutQuery = url.split('?')[0] ?? '';
  const ext = withoutQuery.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
};

const FETCH_TIMEOUT_MS = 30_000;

const inFlight = new Map<string, Promise<CachedMedia | null>>();

// De-dupe eviction passes: a burst of writes (loading a screenshot grid) would
// otherwise stat the same directory N times in parallel.
let evictionInFlight: Promise<void> | null = null;
const scheduleEviction = (): void => {
  if (evictionInFlight) return;
  evictionInFlight = enforceSizeBound(CACHE_NAMESPACE, MEDIA_CACHE_MAX_BYTES).finally(() => {
    evictionInFlight = null;
  });
};

const fetchAndStore = async (sourceUrl: string, cacheKey: string): Promise<CachedMedia | null> => {
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn(`Failed to fetch media (${response.status}): ${sourceUrl}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeBuffer(CACHE_NAMESPACE, cacheKey, buffer);
    scheduleEviction();
    return {
      body: buffer,
      mimeType: response.headers.get('content-type') ?? guessMimeFromUrl(sourceUrl),
    };
  } catch (error) {
    logger.warn(`Network error fetching media: ${sourceUrl}`, error);
    return null;
  }
};

export const fetchCachedMedia = async (sourceUrl: string): Promise<CachedMedia | null> => {
  const cacheKey = hashUrl(sourceUrl);
  const cached = await readBuffer(CACHE_NAMESPACE, cacheKey);
  if (cached) {
    return { body: cached, mimeType: guessMimeFromUrl(sourceUrl) };
  }

  // De-dupe concurrent <img>s in the same render tick.
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = fetchAndStore(sourceUrl, cacheKey).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, promise);
  return promise;
};

export const prewarmMediaCache = async (sourceUrl: string, body: Buffer): Promise<void> => {
  await writeBuffer(CACHE_NAMESPACE, hashUrl(sourceUrl), body);
  scheduleEviction();
};

export const invalidateMediaCache = async (sourceUrl: string): Promise<void> => {
  await deleteBuffer(CACHE_NAMESPACE, hashUrl(sourceUrl));
};

export const clearMediaCache = async (): Promise<void> => {
  await clearNamespace(CACHE_NAMESPACE);
};

export const getMediaCacheSize = (): Promise<number> => getNamespaceSize(CACHE_NAMESPACE);
