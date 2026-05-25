import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { BrowserWindow } from 'electron';
import { createBroadcaster } from './broadcast';
import { MinecraftManager } from './manager';
import { registerMinecraftRoutes } from './routes';

export type MinecraftService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
  // Exposed so the bundle service can install a launch hook that runs after
  // the minecraft-install step and before the game process spawns.
  manager: MinecraftManager;
};

export const createMinecraftService = (
  router: Router,
  mainWindow: BrowserWindow,
  kit: MinecraftKit,
): MinecraftService => {
  const broadcaster = createBroadcaster(mainWindow);
  const manager = new MinecraftManager(broadcaster, kit);
  return {
    init: async () => {
      registerMinecraftRoutes(router, manager);
    },
    dispose: async () => {
      manager.cancelAll();
    },
    manager,
  };
};
