import { createHash } from 'node:crypto';
import { deleteBuffer, readBuffer, writeBuffer } from '@main/infra/cache';
import { scopedLogger } from '@main/infra/logger';

const CACHE_NAMESPACE = 'media';

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

const inFlight = new Map<string, Promise<CachedMedia | null>>();

const fetchAndStore = async (sourceUrl: string, cacheKey: string): Promise<CachedMedia | null> => {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      logger.warn(`Failed to fetch media (${response.status}): ${sourceUrl}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeBuffer(CACHE_NAMESPACE, cacheKey, buffer);
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
  const cached = readBuffer(CACHE_NAMESPACE, cacheKey);
  if (cached) {
    return { body: cached, mimeType: guessMimeFromUrl(sourceUrl) };
  }

  // De-dupe concurrent requests for the same URL — multiple <img>s rendered in the same
  // tick would otherwise each hit the network on first load.
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = fetchAndStore(sourceUrl, cacheKey).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, promise);
  return promise;
};

// Seed the disk cache directly when bytes are already in memory (e.g. just-uploaded skins).
// Saves the next cache:// request from issuing a network round-trip.
export const prewarmMediaCache = (sourceUrl: string, body: Buffer): void => {
  writeBuffer(CACHE_NAMESPACE, hashUrl(sourceUrl), body);
};

// Drop a cached entry — used when the source asset is replaced (skin reset, reupload).
export const invalidateMediaCache = (sourceUrl: string): void => {
  deleteBuffer(CACHE_NAMESPACE, hashUrl(sourceUrl));
};
