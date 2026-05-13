import type { Router } from '@main/ipc/router';
import { registerAppRoutes } from './routes';

export type AppService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createAppService = (router: Router): AppService => ({
  init: async () => {
    registerAppRoutes(router);
  },
  dispose: async () => {},
});
