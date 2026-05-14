import type { Router } from '@main/ipc/router';
import { registerSkinRoutes } from './routes';

export type SkinService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createSkinService = (router: Router): SkinService => ({
  init: async () => {
    registerSkinRoutes(router);
  },
  dispose: async () => {},
});
