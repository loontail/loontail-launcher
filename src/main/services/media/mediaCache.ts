import { createHash } from 'node:crypto';
import { HTTP_NOT_MODIFIED } from '@main/constants/http';
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
import {
  classifyUrl,
  enforceTransport,
  isTransportDowngrade,
  type OriginPolicy,
  trustOf,
} from '@main/infra/originPolicy';

const CACHE_NAMESPACE = 'media';

// Mojang serves a Microsoft account's skin and cape from this host, so without it
// those textures 403 and never render. It is `public`: the session bearer is never
// attached to it, and a redirect off it is refused like any other untrusted host.
const MOJANG_TEXTURE_HOST = 'textures.minecraft.net';

// The decoded `cache://` source URL is renderer-influenceable, so only the API
// origin and the Mojang texture host are reachable. NO local-host carve-out here:
// it would turn `cache://` into an SSRF probe against 127.0.0.1 / 169.254.169.254.
const MEDIA_ORIGIN_POLICY: OriginPolicy = { publicHosts: [MOJANG_TEXTURE_HOST] };

export const isTrustedMediaOrigin = (url: string): boolean =>
  trustOf(url, MEDIA_ORIGIN_POLICY) !== null;

// Bound manual redirect following so a misconfigured server can't loop forever.
const MEDIA_MAX_REDIRECTS = 5;

// Cap the on-disk cache so image churn doesn't accrete a multi-GB footprint;
// LRU pruning runs after every write.
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

// `type/subtype` plus optional printable parameters. Whatever comes off the wire
// or off a torn sidecar ends up in a `Content-Type` response header, where a
// newline throws inside the Response constructor and anything else silently fails
// to decode.
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+(?:;[ -~]*)?$/;

const asMimeType = (value: string | null): string | null =>
  value && MIME_PATTERN.test(value) ? value : null;

// Metadata sidecar next to the body. It carries the served Content-Type (media
// and skin URLs are often extensionless, where a URL guess degrades to
// application/octet-stream) plus the validators needed to re-check freshness.
// Written AFTER the body: the sidecar is what commits freshness, so writing it
// first would pin bytes that never landed under fresh validators for a whole
// revalidation window. A body found without a readable sidecar is repaired on the
// next read (see `repairMeta`). Old plain-text sidecars still parse.
export const MEDIA_SIDECAR_SUFFIX = '.type';

const typeKey = (cacheKey: string): string => `${cacheKey}${MEDIA_SIDECAR_SUFFIX}`;

// Entries are keyed by URL hash alone, so a poster replaced in place at the same
// URL would otherwise be frozen until the user clears the cache.
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

type MediaMeta = {
  mimeType: string;
  etag: string | null;
  lastModified: string | null;
  storedAt: number;
};

const storeMeta = (cacheKey: string, meta: MediaMeta): Promise<boolean> =>
  writeBuffer(CACHE_NAMESPACE, typeKey(cacheKey), Buffer.from(JSON.stringify(meta), 'utf8'));

const metaFromResponse = (response: Response, sourceUrl: string): MediaMeta => ({
  mimeType: asMimeType(response.headers.get('content-type')) ?? guessMimeFromUrl(sourceUrl),
  etag: response.headers.get('etag'),
  lastModified: response.headers.get('last-modified'),
  storedAt: Date.now(),
});

const readMeta = async (cacheKey: string): Promise<MediaMeta | null> => {
  const stored = await readBuffer(CACHE_NAMESPACE, typeKey(cacheKey));
  if (!stored) return null;
  const text = stored.toString('utf8');
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<MediaMeta>;
    const mimeType = typeof parsed.mimeType === 'string' ? asMimeType(parsed.mimeType) : null;
    if (!mimeType) return null;
    return {
      mimeType,
      etag: parsed.etag ?? null,
      lastModified: parsed.lastModified ?? null,
      storedAt: typeof parsed.storedAt === 'number' ? parsed.storedAt : 0,
    };
  } catch {
    // Sidecar written before the metadata format: the whole file was the type. A
    // torn JSON write lands here too, so it only counts as legacy if it still
    // looks like a MIME type.
    const mimeType = asMimeType(text);
    return mimeType ? { mimeType, etag: null, lastModified: null, storedAt: 0 } : null;
  }
};

// A body whose sidecar is missing or unreadable (interrupted write, torn JSON,
// companion evicted from under it) would otherwise serve a guessed MIME forever:
// with no meta, nothing schedules a revalidation. Treat it as infinitely stale so
// the very next read repairs the pair.
const repairMeta = (sourceUrl: string): MediaMeta => ({
  mimeType: guessMimeFromUrl(sourceUrl),
  etag: null,
  lastModified: null,
  storedAt: 0,
});

const FETCH_TIMEOUT_MS = 30_000;

const inFlight = new Map<string, Promise<CachedMedia | null>>();

// De-dupe eviction passes so a burst of writes doesn't stat the same directory
// N times in parallel.
let evictionInFlight: Promise<void> | null = null;
const scheduleEviction = (): void => {
  if (evictionInFlight) return;
  evictionInFlight = enforceSizeBound(CACHE_NAMESPACE, MEDIA_CACHE_MAX_BYTES, {
    companionSuffix: MEDIA_SIDECAR_SUFFIX,
  }).finally(() => {
    evictionInFlight = null;
  });
};

// Manual redirect handling so a 30x can't smuggle the bearer off-origin: every
// hop (and the initial URL) is re-classified, and the bearer is attached only
// while the hop is still our own API.
const fetchTrustedMedia = async (
  sourceUrl: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response | null> => {
  let current = enforceTransport(sourceUrl);
  for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop++) {
    const verdict = classifyUrl(current, MEDIA_ORIGIN_POLICY);
    if (verdict.trust === null) {
      logger.warn(`Refusing media fetch to untrusted host: ${current} (${verdict.reason})`);
      return null;
    }
    const response = await fetch(current, {
      headers: { ...(verdict.trust === 'api' ? sessionAuthHeader() : {}), ...extraHeaders },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        logger.warn(`Media redirect without Location: ${current}`);
        return null;
      }
      const next = new URL(location, current);
      if (isTransportDowngrade(verdict.url, next)) {
        logger.warn(`Refusing media redirect that drops TLS: ${current} -> ${next.toString()}`);
        return null;
      }
      current = enforceTransport(next.toString());
      continue;
    }
    return response;
  }
  logger.warn(`Too many media redirects fetching: ${sourceUrl}`);
  return null;
};

// Body first, sidecar second, on a first write and on a replacement alike: the
// sidecar carries the validators and `storedAt` that suppress the next
// revalidation, so committing it over bytes that failed to land pins the stale
// copy. If the sidecar itself fails, drop it — a body with no sidecar is repaired
// on the next read, whereas a stale sidecar over fresh bytes is not detectable.
const storeMedia = async (cacheKey: string, body: Buffer, meta: MediaMeta): Promise<boolean> => {
  if (!(await writeBuffer(CACHE_NAMESPACE, cacheKey, body))) return false;
  if (!(await storeMeta(cacheKey, meta))) {
    await deleteBuffer(CACHE_NAMESPACE, typeKey(cacheKey));
    return false;
  }
  scheduleEviction();
  return true;
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
    const meta = metaFromResponse(response, sourceUrl);
    await storeMedia(cacheKey, buffer, meta);
    return { body: buffer, mimeType: meta.mimeType };
  } catch (error) {
    logger.warn(`Network error fetching media: ${sourceUrl}`, error);
    return null;
  }
};

const revalidating = new Set<string>();

// Conditional GET behind a cache hit: the cached bytes are served immediately and
// a 304 (or any network failure) leaves them in place, so a replaced poster
// refreshes on its own without ever blocking a render.
const revalidate = async (sourceUrl: string, cacheKey: string, meta: MediaMeta): Promise<void> => {
  const response = await fetchTrustedMedia(sourceUrl, {
    ...(meta.etag ? { 'If-None-Match': meta.etag } : {}),
    ...(meta.lastModified ? { 'If-Modified-Since': meta.lastModified } : {}),
  });
  if (!response) return;
  if (response.status === HTTP_NOT_MODIFIED) {
    await storeMeta(cacheKey, { ...meta, storedAt: Date.now() });
    return;
  }
  if (!response.ok) return;
  const buffer = Buffer.from(await response.arrayBuffer());
  await storeMedia(cacheKey, buffer, metaFromResponse(response, sourceUrl));
};

const scheduleRevalidation = (sourceUrl: string, cacheKey: string, meta: MediaMeta): void => {
  if (Date.now() - meta.storedAt < REVALIDATE_AFTER_MS) return;
  if (revalidating.has(cacheKey)) return;
  revalidating.add(cacheKey);
  void revalidate(sourceUrl, cacheKey, meta)
    .catch((error: unknown) => {
      logger.warn(`Media revalidation failed; keeping the cached copy: ${sourceUrl}`, error);
    })
    .finally(() => {
      revalidating.delete(cacheKey);
    });
};

export const fetchCachedMedia = async (sourceUrl: string): Promise<CachedMedia | null> => {
  const cacheKey = hashUrl(sourceUrl);
  const cached = await readBuffer(CACHE_NAMESPACE, cacheKey);
  if (cached) {
    const meta = await readMeta(cacheKey);
    scheduleRevalidation(sourceUrl, cacheKey, meta ?? repairMeta(sourceUrl));
    return { body: cached, mimeType: meta?.mimeType ?? guessMimeFromUrl(sourceUrl) };
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
  // Prewarm only ever stores an uploaded skin/cape PNG (validated upstream), and
  // it is the freshest copy by definition — no validators to revalidate against.
  await storeMedia(cacheKey, body, {
    mimeType: 'image/png',
    etag: null,
    lastModified: null,
    storedAt: Date.now(),
  });
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
