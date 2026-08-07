import { KEY_REQUIRED_MSG, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { BundleStartRequestSchema } from '@shared/contracts/bundle';
import { CatalogKeySchema } from '@shared/contracts/ids';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BundleManager } from './manager';

export const registerBundleRoutes = (router: Router, manager: BundleManager): void => {
  router.handle(IPC_CHANNELS.bundleStart, async (rawArgs) => {
    const payload = parseIpcArgs(BundleStartRequestSchema, rawArgs, 'Invalid bundle start request');
    await manager.start(payload);
  });

  router.handle(IPC_CHANNELS.bundlePause, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.pause(key);
  });

  router.handle(IPC_CHANNELS.bundleResume, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    await manager.resume(key);
  });

  router.handle(IPC_CHANNELS.bundleCancel, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.cancel(key);
  });

  router.handle(IPC_CHANNELS.bundleGetStatus, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    return manager.getStatus(key);
  });
};
