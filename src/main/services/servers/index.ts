import type { Router } from '@main/ipc/router';
import { registerServersRoutes } from './routes';

export type ServersService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createServersService = (router: Router): ServersService => ({
  init: async () => {
    registerServersRoutes(router);
  },
  // No subscriptions or timers to release.
  dispose: () => Promise.resolve(),
});
