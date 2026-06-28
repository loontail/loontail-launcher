import { KEY_REQUIRED_MSG, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { BundleStartRequestSchema } from '@shared/contracts/bundle';
import { CatalogKeySchema } from '@shared/contracts/ids';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BundleManager } from './manager';

export const registerBundleRoutes = (router: Router, manager: BundleManager): void => {
  router.handle(IPC_CHANNELS.bundleStart, async (rawArgs) => {
    const payload = parseIpcArgs(BundleStartRequestSchema, rawArgs, 'Invalid bundle start request');
    await manager.startSync(payload);
  });

  router.handle(IPC_CHANNELS.bundlePause, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.pauseSync(key);
  });

  router.handle(IPC_CHANNELS.bundleResume, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    await manager.resumeSync(key);
  });

  router.handle(IPC_CHANNELS.bundleCancel, (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    manager.cancelSync(key);
  });

  router.handle(IPC_CHANNELS.bundleCheckStatus, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    return manager.getInstallState(key);
  });
};
