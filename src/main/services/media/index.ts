import type { Router } from '@main/ipc/router';
import { CACHE_SCHEME, registerMediaProtocol } from './protocol';
import { registerMediaRoutes } from './routes';

export { CACHE_SCHEME };

export type MediaService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createMediaService = (router: Router): MediaService => ({
  init: async () => {
    registerMediaProtocol();
    registerMediaRoutes(router);
  },
  // The cache:// handler registered by registerMediaProtocol persists for the
  // process lifetime (Electron unregisters it on exit); there is nothing for
  // dispose to tear down.
  dispose: () => Promise.resolve(),
});
