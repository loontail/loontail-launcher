import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { ClientOperationLocks } from '@main/services/clientOperationLocks';
import type { LauncherService } from '@main/services/service';
import type { BrowserWindow } from 'electron';
import { createBroadcaster } from './broadcast';
import type { ConsoleSink } from './env';
import {
  type AccountProvider,
  type ClearBundleManifest,
  MinecraftManager,
  type ResolveBuild,
  type ResolveBundleRepairFilter,
} from './manager';
import { registerMinecraftRoutes } from './routes';

export type MinecraftService = LauncherService & {
  // Exposed so the bundle service can install a launch hook between install and spawn.
  manager: MinecraftManager;
};

export const createMinecraftService = (
  router: Router,
  getMainWindow: () => BrowserWindow,
  kit: MinecraftKit,
  operationLocks: ClientOperationLocks,
  consoleHub: ConsoleSink,
  openConsole: () => void,
  accountProvider: AccountProvider,
  resolveBundleRepairFilter: ResolveBundleRepairFilter,
  clearBundleManifest: ClearBundleManifest,
  resolveBuild: ResolveBuild,
): MinecraftService => {
  const broadcaster = createBroadcaster(getMainWindow);
  const manager = new MinecraftManager(
    broadcaster,
    kit,
    operationLocks,
    consoleHub,
    openConsole,
    accountProvider,
    resolveBundleRepairFilter,
    clearBundleManifest,
    resolveBuild,
  );
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
