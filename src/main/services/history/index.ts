import type { Router } from '@main/ipc/router';
import { registerHistoryRoutes } from './routes';

export type HistoryService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createHistoryService = (router: Router): HistoryService => ({
  init: async () => {
    registerHistoryRoutes(router);
  },
  dispose: () => Promise.resolve(),
});
