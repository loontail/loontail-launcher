import { CACHE_MEDIA_PREFIX } from '@shared/constants';

// Wrap an HTTP(S) URL so the disk media cache serves it; anything else is
// returned unchanged.
export const toCachedMediaUrl = (originalUrl: string): string => {
  if (!originalUrl) return originalUrl;
  if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
    return originalUrl;
  }
  return `${CACHE_MEDIA_PREFIX}${encodeURIComponent(originalUrl)}`;
};
