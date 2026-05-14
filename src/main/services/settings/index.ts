import type { Router } from '@main/ipc/router';
import type { BrowserWindow } from 'electron';
import { registerSettingsRoutes } from './routes';

export type SettingsService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createSettingsService = (
  router: Router,
  mainWindow: BrowserWindow,
): SettingsService => ({
  init: async () => {
    registerSettingsRoutes(router, mainWindow);
  },
  dispose: async () => {},
});
