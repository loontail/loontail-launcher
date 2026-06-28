import { isMinecraftKitError } from '@loontail/minecraft-kit';
import { KEY_REQUIRED_MSG, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { CatalogKeySchema } from '@shared/contracts/ids';
import { InstallRequestSchema } from '@shared/contracts/minecraft';
import { IPC_CHANNELS } from '@shared/ipc';
import { ManagerError, classifyError } from './errors';
import type { MinecraftManager } from './manager';

// buildContext (via kit.targets.resolve) can throw a raw MinecraftKitError out
// of the install/repair/launch entry points. Left unwrapped, toIpcError would
// collapse it to the opaque IpcHandlerFailed code; reclassify it into a coded
// ManagerError here so the renderer receives an actionable launcher code.
const withClassifiedKitError = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run();
  } catch (error) {
    if (isMinecraftKitError(error)) {
      throw new ManagerError(classifyError(error), error.message);
    }
    throw error;
  }
};

export const registerMinecraftRoutes = (router: Router, manager: MinecraftManager): void => {
  router.handle(IPC_CHANNELS.minecraftGetStatus, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    return manager.getStatus(key);
  });

  router.handle(IPC_CHANNELS.minecraftInstall, async (rawArgs) => {
    const payload = parseIpcArgs(InstallRequestSchema, rawArgs, 'Invalid install request');
    await withClassifiedKitError(() => manager.startInstall(payload.slug, payload.loader));
  });

  router.handle(IPC_CHANNELS.minecraftPause, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.pause(key);
  });

  router.handle(IPC_CHANNELS.minecraftResume, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.resume(key);
  });

  router.handle(IPC_CHANNELS.minecraftCancel, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.cancel(key);
  });

  router.handle(IPC_CHANNELS.minecraftRepair, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    await withClassifiedKitError(() => manager.startRepair(key));
  });

  router.handle(IPC_CHANNELS.minecraftUninstall, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    await manager.uninstall(key);
  });

  router.handle(IPC_CHANNELS.minecraftLaunch, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    await withClassifiedKitError(() => manager.startLaunch(key));
  });

  router.handle(IPC_CHANNELS.minecraftStop, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.stop(key);
  });
};
