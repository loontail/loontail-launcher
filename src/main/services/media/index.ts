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
  dispose: async () => {},
});
