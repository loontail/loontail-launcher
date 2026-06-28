import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { ClientOperationLocks } from '@main/services/clientOperationLocks';
import type { BrowserWindow } from 'electron';
import { createBroadcaster } from './broadcast';
import type { ConsolePort } from './env';
import {
  type AccountProvider,
  MinecraftManager,
  type ResolveBuild,
  type ResolveBundleRepairFilter,
} from './manager';
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
  getMainWindow: () => BrowserWindow,
  kit: MinecraftKit,
  operationLocks: ClientOperationLocks,
  consoleHub: ConsolePort,
  openConsole: () => void,
  accountProvider: AccountProvider,
  resolveBundleRepairFilter: ResolveBundleRepairFilter,
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
