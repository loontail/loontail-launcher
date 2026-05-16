import type { Router } from '@main/ipc/router';
import { invalidateClientsCache } from './clients';
import { registerClientsRoutes } from './routes';

export { getClient, getClientsCached } from './clients';

export type ClientsService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createClientsService = (router: Router): ClientsService => ({
  init: async () => {
    registerClientsRoutes(router);
  },
  dispose: async () => {
    invalidateClientsCache();
  },
});
