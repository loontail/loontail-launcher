import { scopedLogger } from '@main/infra/logger';
import { protocol } from 'electron';
import { fetchCachedMedia } from './mediaCache';

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
  // Only proxy real remote media. Rejecting non-http(s) schemes (file:, data:,
  // app:, …) stops a crafted cache:// URL from making the main process fetch an
  // arbitrary local or internal resource (SSRF).
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
