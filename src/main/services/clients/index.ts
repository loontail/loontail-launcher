import type { Router } from '@main/ipc/router';
import { registerClientsRoutes } from './routes';

export type ClientsService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createClientsService = (router: Router): ClientsService => ({
  init: async () => {
    registerClientsRoutes(router);
  },
  dispose: async () => {},
});
