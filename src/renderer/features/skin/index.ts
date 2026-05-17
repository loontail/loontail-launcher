import { lazy } from 'react';

export { useClearSkin, useUploadSkin } from './hooks';

// Lazy-loaded: pulls skinview3d (~200kB) only when the user opens
// Settings → Account, keeping the home-view first paint smaller.
export const SkinEditor = lazy(() =>
  import('./components/SkinEditor').then((module) => ({ default: module.SkinEditor })),
);
