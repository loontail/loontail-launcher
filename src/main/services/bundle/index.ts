import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { BrowserWindow } from 'electron';
import { createBundleBroadcaster } from './broadcast';
import { createHealer } from './healer';
import { BundleManager } from './manager';
import { registerBundleRoutes } from './routes';

export type BundleService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
  // Exposed so MinecraftManager can chain a sync into the launch flow.
  manager: BundleManager;
};

export const createBundleService = (
  router: Router,
  mainWindow: BrowserWindow,
  kit: MinecraftKit,
): BundleService => {
  const broadcaster = createBundleBroadcaster(mainWindow);
  const healer = createHealer(kit);
  const manager = new BundleManager(broadcaster, healer);
  return {
    init: async () => {
      registerBundleRoutes(router, manager);
    },
    dispose: async () => {},
    manager,
  };
};

export { BundleManager } from './manager';
