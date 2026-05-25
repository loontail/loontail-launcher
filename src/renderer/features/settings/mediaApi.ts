import { IPC_CHANNELS } from '@shared/ipc';

export const clearMediaCache = (): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.mediaClearCache, undefined);

export const getMediaCacheSize = (): Promise<number> =>
  window.api.invoke(IPC_CHANNELS.mediaGetCacheSize, undefined);
