import type { Router } from '@main/ipc/router';
import { clearMediaCache, getMediaCacheSize } from '@main/services/media/mediaCache';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerMediaRoutes = (router: Router): void => {
  router.handleNoArgs(IPC_CHANNELS.mediaClearCache, () => {
    return clearMediaCache();
  });
  router.handleNoArgs(IPC_CHANNELS.mediaGetCacheSize, () => {
    return getMediaCacheSize();
  });
};
