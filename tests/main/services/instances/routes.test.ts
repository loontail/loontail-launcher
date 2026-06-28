import type { MinecraftKit } from '@loontail/minecraft-kit';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { registerInstanceRoutes } from '@main/services/instances/routes';
import { type StoredHandler, createTestRouter } from '../../../helpers/router';

const makeKit = () =>
  ({
    versions: {
      minecraft: {
        list: vi.fn(async () => [{ id: '1.21.4', type: 'release' }]),
      },
    },
  }) as unknown as MinecraftKit;

const getHandler = (handlers: Map<string, StoredHandler>, channel: string): StoredHandler => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
};

describe('registerInstanceRoutes', () => {
  it('lists minecraft versions when invoked without arguments', async () => {
    const kit = makeKit();
    const { router, handlers } = createTestRouter();
    registerInstanceRoutes(router, kit);

    const handler = getHandler(handlers, IPC_CHANNELS.buildsListMinecraftVersions);

    await expect(handler(undefined)).resolves.toEqual([{ id: '1.21.4', type: 'release' }]);
    expect(kit.versions.minecraft.list).toHaveBeenCalledTimes(1);
  });

  it('rejects builds.listMinecraftVersions with IPC_INVALID_ARGS when a payload is supplied', async () => {
    const kit = makeKit();
    const { router, handlers } = createTestRouter();
    registerInstanceRoutes(router, kit);

    const handler = getHandler(handlers, IPC_CHANNELS.buildsListMinecraftVersions);

    await expect(handler({ unexpected: true })).rejects.toMatchObject({
      code: ERROR_CODES.IpcInvalidArgs,
    });
    expect(kit.versions.minecraft.list).not.toHaveBeenCalled();
  });
});
