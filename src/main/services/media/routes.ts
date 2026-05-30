import { assertNoIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { clearMediaCache, getMediaCacheSize } from '@main/services/media/mediaCache';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerMediaRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.mediaClearCache, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'media.clearCache takes no arguments');
    return clearMediaCache();
  });
  router.handle(IPC_CHANNELS.mediaGetCacheSize, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'media.getCacheSize takes no arguments');
    return getMediaCacheSize();
  });
};
