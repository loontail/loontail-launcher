import type { Router } from '@main/ipc/router';
import type { BrowserWindow } from 'electron';
import { registerSystemRoutes } from './routes';

export type SystemService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createSystemService = (router: Router, mainWindow: BrowserWindow): SystemService => ({
  init: async () => {
    registerSystemRoutes(router, mainWindow);
  },
  // No subscriptions or timers to release.
  dispose: () => Promise.resolve(),
});
