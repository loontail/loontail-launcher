import { scopedLogger } from '@main/infra/logger';
import { CACHE_MEDIA_PREFIX, CACHE_SCHEME } from '@shared/constants';
import { protocol } from 'electron';
import { fetchCachedMedia, isTrustedMediaOrigin } from './mediaCache';

const MEDIA_MAX_AGE_SECONDS = 86_400;

const logger = scopedLogger('media-protocol');

const decodeSourceUrl = (cacheUrl: string): string | null => {
  if (!cacheUrl.startsWith(CACHE_MEDIA_PREFIX)) return null;
  try {
    return decodeURIComponent(cacheUrl.slice(CACHE_MEDIA_PREFIX.length));
  } catch {
    return null;
  }
};

export const registerMediaProtocol = (): void => {
  protocol.handle(CACHE_SCHEME, async (request) => {
    const sourceUrl = decodeSourceUrl(request.url);
    if (!sourceUrl) {
      return new Response(null, { status: 400 });
    }
    // Host-pin here too (mediaCache re-checks before fetching) to reject the
    // SSRF/bearer-exfil request up front with a clear status. This also rejects
    // non-http(s) schemes (file:, data:, app:) — classifyUrl owns that rule.
    if (!isTrustedMediaOrigin(sourceUrl)) {
      logger.warn(`Rejected media request to untrusted source: ${sourceUrl}`);
      return new Response(null, { status: 403 });
    }
    const cached = await fetchCachedMedia(sourceUrl);
    if (!cached) {
      return new Response(null, { status: 502 });
    }
    // Buffer is BodyInit-compatible at runtime; widen via `unknown` for tsc's main lib.
    return new Response(cached.body as unknown as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': cached.mimeType,
        // NOT immutable: the disk entry is keyed by URL hash, so a poster replaced
        // in place keeps its URL. A day-long max-age keeps renders free while
        // letting the renderer pick up the copy mediaCache revalidated.
        'Cache-Control': `public, max-age=${MEDIA_MAX_AGE_SECONDS}`,
      },
    });
  });
  logger.info(`${CACHE_SCHEME}:// protocol registered`);
};
