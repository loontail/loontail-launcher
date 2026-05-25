import type { Router } from '@main/ipc/router';
import { clearMediaCache, getMediaCacheSize } from '@main/services/media/mediaCache';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerMediaRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.mediaClearCache, () => clearMediaCache());
  router.handle(IPC_CHANNELS.mediaGetCacheSize, () => getMediaCacheSize());
};
