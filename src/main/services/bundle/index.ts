import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { ClientOperationLocks } from '@main/services/clientOperationLocks';
import type { BrowserWindow } from 'electron';
import { createBundleBroadcaster } from './broadcast';
import { type CreateHealerDeps, createHealer } from './healer';
import { BundleManager, type GetClient } from './manager';
import { registerBundleRoutes } from './routes';

export type BundleService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
  // Exposed so MinecraftManager can chain a sync into the launch flow.
  manager: BundleManager;
};

export const createBundleService = (
  router: Router,
  getMainWindow: () => BrowserWindow,
  kit: MinecraftKit,
  operationLocks: ClientOperationLocks,
  healDeps: CreateHealerDeps,
  getClient: GetClient,
): BundleService => {
  const broadcaster = createBundleBroadcaster(getMainWindow);
  const healer = createHealer(kit, healDeps);
  const manager = new BundleManager(broadcaster, healer, operationLocks, undefined, getClient);
  return {
    init: async () => {
      registerBundleRoutes(router, manager);
    },
    dispose: async () => {
      await manager.cancelAll();
    },
    manager,
  };
};

export { BundleManager } from './manager';
