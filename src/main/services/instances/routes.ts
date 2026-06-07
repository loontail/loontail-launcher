import type { MinecraftKit } from '@loontail/minecraft-kit';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { InstanceIdSchema } from '@shared/contracts/ids';
import {
  CreateInstancePayloadSchema,
  ListLoaderVersionsArgsSchema,
  UpdateInstancePayloadSchema,
} from '@shared/contracts/instance';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  createInstance,
  deleteInstance,
  listLoaderVersionOptions,
  listMinecraftVersionOptions,
  updateInstance,
} from './create';

export const registerInstanceRoutes = (router: Router, kit: MinecraftKit): void => {
  router.handle(IPC_CHANNELS.buildsCreate, async (rawArgs) => {
    const payload = parseIpcArgs(
      CreateInstancePayloadSchema,
      rawArgs,
      'Invalid builds.create payload',
    );
    return createInstance(kit, payload);
  });

  router.handle(IPC_CHANNELS.buildsUpdate, async (rawArgs) => {
    const payload = parseIpcArgs(
      UpdateInstancePayloadSchema,
      rawArgs,
      'Invalid builds.update payload',
    );
    return updateInstance(payload);
  });

  router.handle(IPC_CHANNELS.buildsDelete, async (rawArgs) => {
    const id = parseIpcArgs(InstanceIdSchema, rawArgs, 'Invalid builds.delete payload');
    await deleteInstance(id);
  });

  router.handle(IPC_CHANNELS.buildsListMinecraftVersions, async () =>
    listMinecraftVersionOptions(kit),
  );

  router.handle(IPC_CHANNELS.buildsListLoaderVersions, async (rawArgs) => {
    const args = parseIpcArgs(
      ListLoaderVersionsArgsSchema,
      rawArgs,
      'Invalid builds.listLoaderVersions payload',
    );
    return listLoaderVersionOptions(kit, args);
  });
};
