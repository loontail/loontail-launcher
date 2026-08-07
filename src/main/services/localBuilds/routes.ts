import type { MinecraftKit } from '@loontail/minecraft-kit';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { LocalBuildIdSchema } from '@shared/contracts/ids';
import {
  CreateBuildPayloadSchema,
  ListLoaderVersionsArgsSchema,
  UpdateBuildPayloadSchema,
} from '@shared/contracts/localBuild';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  createLocalBuild,
  deleteLocalBuild,
  listLoaderVersionOptions,
  listMinecraftVersionOptions,
  updateLocalBuild,
} from './create';

export const registerBuildRoutes = (router: Router, kit: MinecraftKit): void => {
  router.handle(IPC_CHANNELS.buildsCreate, async (rawArgs) => {
    const payload = parseIpcArgs(
      CreateBuildPayloadSchema,
      rawArgs,
      'Invalid builds.create payload',
    );
    return createLocalBuild(kit, payload);
  });

  router.handle(IPC_CHANNELS.buildsUpdate, async (rawArgs) => {
    const payload = parseIpcArgs(
      UpdateBuildPayloadSchema,
      rawArgs,
      'Invalid builds.update payload',
    );
    return updateLocalBuild(payload);
  });

  router.handle(IPC_CHANNELS.buildsDelete, async (rawArgs) => {
    const id = parseIpcArgs(LocalBuildIdSchema, rawArgs, 'Invalid builds.delete payload');
    await deleteLocalBuild(id);
  });

  router.handleNoArgs(IPC_CHANNELS.buildsListMinecraftVersions, () => {
    return listMinecraftVersionOptions(kit);
  });

  router.handle(IPC_CHANNELS.buildsListLoaderVersions, async (rawArgs) => {
    const args = parseIpcArgs(
      ListLoaderVersionsArgsSchema,
      rawArgs,
      'Invalid builds.listLoaderVersions payload',
    );
    return listLoaderVersionOptions(kit, args);
  });
};
