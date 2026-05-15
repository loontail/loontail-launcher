// Mirror of the scheme registered in main/services/media — keep in sync.
const CACHE_SCHEME = 'cache';
const PATH_PREFIX = `${CACHE_SCHEME}://media/`;

// Wrap an HTTP(S) URL so the disk media cache serves it. Anything else (data:, blob:,
// bundled Vite asset paths, already-wrapped cache:// URLs) is returned unchanged so the
// browser keeps treating it as a normal resource.
export const toCachedMediaUrl = (originalUrl: string): string => {
  if (!originalUrl) return originalUrl;
  if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
    return originalUrl;
  }
  return `${PATH_PREFIX}${encodeURIComponent(originalUrl)}`;
};
