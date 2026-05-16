import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { getStoredAccount } from '@main/services/auth/auth';
import { ClientSlugSchema } from '@shared/contracts/ids';
import { InstallRequestSchema } from '@shared/contracts/minecraft';
import { IPC_CHANNELS } from '@shared/ipc';
import type { MinecraftManager } from './manager';

const SLUG_REQUIRED = 'slug must be a non-empty string';

export const registerMinecraftRoutes = (router: Router, manager: MinecraftManager): void => {
  router.handle(IPC_CHANNELS.minecraftGetStatus, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    return manager.getStatus(slug);
  });

  router.handle(IPC_CHANNELS.minecraftInstall, async (rawArgs) => {
    const payload = parseIpcArgs(InstallRequestSchema, rawArgs, 'Invalid install request');
    await manager.startInstall(payload.slug, payload.loader);
  });

  router.handle(IPC_CHANNELS.minecraftPause, (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    manager.pause(slug);
  });

  router.handle(IPC_CHANNELS.minecraftResume, (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    manager.resume(slug);
  });

  router.handle(IPC_CHANNELS.minecraftCancel, (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    manager.cancel(slug);
  });

  router.handle(IPC_CHANNELS.minecraftRepair, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    await manager.startRepair(slug);
  });

  router.handle(IPC_CHANNELS.minecraftUninstall, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    await manager.uninstall(slug);
  });

  router.handle(IPC_CHANNELS.minecraftLaunch, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    await manager.startLaunch(slug, getStoredAccount());
  });

  router.handle(IPC_CHANNELS.minecraftStop, (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    manager.stop(slug);
  });
};
