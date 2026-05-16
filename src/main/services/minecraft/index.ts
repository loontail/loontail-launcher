import type { Router } from '@main/ipc/router';
import type { BrowserWindow } from 'electron';
import { createBroadcaster } from './broadcast';
import { MinecraftManager } from './manager';
import { registerMinecraftRoutes } from './routes';

export type MinecraftService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createMinecraftService = (
  router: Router,
  mainWindow: BrowserWindow,
): MinecraftService => {
  const broadcaster = createBroadcaster(mainWindow);
  const manager = new MinecraftManager(broadcaster);
  return {
    init: async () => {
      registerMinecraftRoutes(router, manager);
    },
    dispose: async () => {},
  };
};
