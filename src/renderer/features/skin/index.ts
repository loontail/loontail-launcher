import { lazy } from 'react';

export { localizeSkinError } from './errorCopy';
export { useClearSkin, useSkinEditor } from './hooks';

// Lazy-loaded so skinview3d (~200kB) is pulled only when Settings → Account opens.
export const SkinViewerCard = lazy(() =>
  import('./components/SkinViewerCard').then((module) => ({ default: module.SkinViewerCard })),
);
