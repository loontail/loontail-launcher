import type { Router } from '@main/ipc/router';
import { registerAuthRoutes } from './routes';

export type AuthService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createAuthService = (router: Router): AuthService => ({
  init: async () => {
    registerAuthRoutes(router);
  },
  dispose: async () => {},
});
