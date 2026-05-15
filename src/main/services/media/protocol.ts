import { scopedLogger } from '@main/infra/logger';
import { protocol } from 'electron';
import { fetchCachedMedia } from './mediaCache';

export const CACHE_SCHEME = 'cache';

const PATH_PREFIX = `${CACHE_SCHEME}://media/`;

const logger = scopedLogger('media-protocol');

const decodeSourceUrl = (cacheUrl: string): string | null => {
  if (!cacheUrl.startsWith(PATH_PREFIX)) return null;
  const encoded = cacheUrl.slice(PATH_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
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
    const cached = await fetchCachedMedia(sourceUrl);
    if (!cached) {
      return new Response(null, { status: 502 });
    }
    // Node's Buffer is BodyInit-compatible at runtime but tsc's main-target lib doesn't
    // expose BodyInit, so widen via `unknown`.
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
