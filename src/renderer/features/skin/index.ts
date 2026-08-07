import { lazy } from 'react';

export { localizeSkinError } from './errorCopy';
export { useClearSkin, useSkinEditor } from './hooks';

// Lazy-loaded because this is by far the largest renderer chunk: ~510 kB minified
// (~124 kB gzipped), almost all of it the three.js copy skinview3d pulls in. Pulled
// only when Settings → Account opens. Re-measure out/renderer/assets/ before quoting
// a new number here.
export const SkinViewerCard = lazy(() =>
  import('./components/SkinViewerCard').then((module) => ({ default: module.SkinViewerCard })),
);
