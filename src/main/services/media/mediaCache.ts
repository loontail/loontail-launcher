import { createHash } from 'node:crypto';
import { mainConfig } from '@main/config';
import {
  clearNamespace,
  deleteBuffer,
  enforceSizeBound,
  getNamespaceSize,
  readBuffer,
  writeBuffer,
} from '@main/infra/cache';
import { sessionAuthHeader } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';

const CACHE_NAMESPACE = 'media';

// The decoded `cache://` source URL is renderer/CMS-influenceable, so it is
// pinned to the configured API origin — there is no separate asset CDN in this
// deployment, so the API origin is the only trusted host. Pinning here closes
// the SSRF (a crafted URL targeting 127.0.0.1 / 169.254.169.254) and stops the
// universal API bearer from being attached to — and leaked at — any other host.
const TRUSTED_MEDIA_ORIGIN = new URL(mainConfig.apiUrl).origin;

export const isTrustedMediaOrigin = (url: string): boolean => {
  try {
    return new URL(url).origin === TRUSTED_MEDIA_ORIGIN;
  } catch {
    return false;
  }
};

// Bound manual redirect following so a misconfigured server can't loop forever.
const MEDIA_MAX_REDIRECTS = 5;

// Cap the on-disk media cache so months of CMS-image churn don't accrete
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

// The served Content-Type is stored in a tiny sidecar entry next to the body so
// a cache hit reports the real type instead of guessing from the URL — CMS
// and skin URLs are often extensionless, where the guess degrades to
// application/octet-stream. A missing sidecar (old entry) falls back to the guess.
const typeKey = (cacheKey: string): string => `${cacheKey}.type`;

const storeMime = (cacheKey: string, mimeType: string): Promise<void> =>
  writeBuffer(CACHE_NAMESPACE, typeKey(cacheKey), Buffer.from(mimeType, 'utf8'));

const readMime = async (cacheKey: string): Promise<string | null> => {
  const stored = await readBuffer(CACHE_NAMESPACE, typeKey(cacheKey));
  return stored ? stored.toString('utf8') : null;
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

// Fetch with manual redirect handling so a 30x cannot smuggle the API bearer to
// an off-origin host: every hop's URL (and the initial URL) is re-validated
// against the trusted origin, and the Authorization header is attached only when
// the request host is that trusted origin.
const fetchTrustedMedia = async (sourceUrl: string): Promise<Response | null> => {
  let current = sourceUrl;
  for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop++) {
    if (!isTrustedMediaOrigin(current)) {
      logger.warn(`Refusing media fetch to non-API host: ${current}`);
      return null;
    }
    const response = await fetch(current, {
      headers: sessionAuthHeader(),
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        logger.warn(`Media redirect without Location: ${current}`);
        return null;
      }
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  logger.warn(`Too many media redirects fetching: ${sourceUrl}`);
  return null;
};

const fetchAndStore = async (sourceUrl: string, cacheKey: string): Promise<CachedMedia | null> => {
  try {
    const response = await fetchTrustedMedia(sourceUrl);
    if (!response) return null;
    if (!response.ok) {
      logger.warn(`Failed to fetch media (${response.status}): ${sourceUrl}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') ?? guessMimeFromUrl(sourceUrl);
    await writeBuffer(CACHE_NAMESPACE, cacheKey, buffer);
    await storeMime(cacheKey, mimeType);
    scheduleEviction();
    return { body: buffer, mimeType };
  } catch (error) {
    logger.warn(`Network error fetching media: ${sourceUrl}`, error);
    return null;
  }
};

export const fetchCachedMedia = async (sourceUrl: string): Promise<CachedMedia | null> => {
  const cacheKey = hashUrl(sourceUrl);
  const cached = await readBuffer(CACHE_NAMESPACE, cacheKey);
  if (cached) {
    return { body: cached, mimeType: (await readMime(cacheKey)) ?? guessMimeFromUrl(sourceUrl) };
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
  const cacheKey = hashUrl(sourceUrl);
  await writeBuffer(CACHE_NAMESPACE, cacheKey, body);
  // Prewarm only ever stores an uploaded skin/cape PNG (validated upstream).
  await storeMime(cacheKey, 'image/png');
  scheduleEviction();
};

export const invalidateMediaCache = async (sourceUrl: string): Promise<void> => {
  const cacheKey = hashUrl(sourceUrl);
  await deleteBuffer(CACHE_NAMESPACE, cacheKey);
  await deleteBuffer(CACHE_NAMESPACE, typeKey(cacheKey));
};

export const clearMediaCache = async (): Promise<void> => {
  await clearNamespace(CACHE_NAMESPACE);
};

export const getMediaCacheSize = (): Promise<number> => getNamespaceSize(CACHE_NAMESPACE);
