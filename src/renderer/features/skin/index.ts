import { lazy } from 'react';

export { localizeSkinError } from './errorCopy';
export { useClearSkin, useSkinEditor } from './hooks';

// Lazy-loaded: pulls skinview3d (~200kB) only when the user opens
// Settings → Account, keeping the home-view first paint smaller.
export const SkinViewerCard = lazy(() =>
  import('./components/SkinViewerCard').then((module) => ({ default: module.SkinViewerCard })),
);
