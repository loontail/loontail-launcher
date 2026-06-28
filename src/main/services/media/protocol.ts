import { scopedLogger } from '@main/infra/logger';
import { protocol } from 'electron';
import { fetchCachedMedia, isTrustedMediaOrigin } from './mediaCache';

export const CACHE_SCHEME = 'cache';

const PATH_PREFIX = `${CACHE_SCHEME}://media/`;

const logger = scopedLogger('media-protocol');

const decodeSourceUrl = (cacheUrl: string): string | null => {
  if (!cacheUrl.startsWith(PATH_PREFIX)) return null;
  const encoded = cacheUrl.slice(PATH_PREFIX.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  // Reject non-http(s) schemes (file:, data:, app:, …) so a crafted cache:// URL
  // can't make the main process fetch a local/internal resource (SSRF).
  try {
    const { protocol: scheme } = new URL(decoded);
    if (scheme !== 'http:' && scheme !== 'https:') return null;
  } catch {
    return null;
  }
  return decoded;
};

export const registerMediaProtocol = (): void => {
  protocol.handle(CACHE_SCHEME, async (request) => {
    const sourceUrl = decodeSourceUrl(request.url);
    if (!sourceUrl) {
      return new Response(null, { status: 400 });
    }
    // Host-pin here too (mediaCache re-checks before fetching) to reject the
    // SSRF/bearer-exfil request up front with a clear status.
    if (!isTrustedMediaOrigin(sourceUrl)) {
      logger.warn(`Rejected media request to non-API host: ${sourceUrl}`);
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
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });
  logger.info(`${CACHE_SCHEME}:// protocol registered`);
};
