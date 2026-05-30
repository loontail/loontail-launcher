import { MinecraftKitError } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import { ManagerError } from '@main/services/minecraft/errors';
import type { MinecraftManager } from '@main/services/minecraft/manager';
import { registerMinecraftRoutes } from '@main/services/minecraft/routes';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { IPC_CHANNELS, type IpcArgs, type IpcContract, type IpcResult } from '@shared/ipc';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/services/auth/auth', () => ({
  getStoredAccount: vi.fn(() => null),
}));

type StoredHandler = (rawArgs: unknown) => Promise<unknown> | unknown;

const fakeEvent = (): IpcMainInvokeEvent => ({}) as unknown as IpcMainInvokeEvent;

const createTestRouter = (): { router: Router; handlers: Map<string, StoredHandler> } => {
  const handlers = new Map<string, StoredHandler>();
  const router: Router = {
    handle<TChannel extends keyof IpcContract>(
      channel: TChannel,
      handler: (
        args: IpcArgs<TChannel>,
        event: IpcMainInvokeEvent,
      ) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>,
    ): void {
      handlers.set(channel, (rawArgs) => handler(rawArgs as IpcArgs<TChannel>, fakeEvent()));
    },
    dispose: () => undefined,
  };
  return { router, handlers };
};

const handlerFor = (channel: string, fail: (slug: string) => Promise<void>): StoredHandler => {
  const manager = {
    startInstall: vi.fn(fail),
    startRepair: vi.fn(fail),
    startLaunch: vi.fn(fail),
  } as unknown as MinecraftManager;
  const { router, handlers } = createTestRouter();
  registerMinecraftRoutes(router, manager);
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
};

const ENTRY_POINTS: Array<[string, unknown]> = [
  [IPC_CHANNELS.minecraftInstall, { slug: 'vanilla' }],
  [IPC_CHANNELS.minecraftRepair, 'vanilla'],
  [IPC_CHANNELS.minecraftLaunch, 'vanilla'],
];

describe('registerMinecraftRoutes error reclassification', () => {
  for (const [channel, payload] of ENTRY_POINTS) {
    it(`reclassifies a raw kit error from ${channel} into a coded ManagerError`, async () => {
      const handler = handlerFor(channel, () =>
        Promise.reject(new MinecraftKitError('NETWORK_TIMEOUT', 'boom')),
      );
      await expect(handler(payload)).rejects.toMatchObject({
        name: 'ManagerError',
        code: MinecraftErrorCodes.NETWORK_ERROR,
      });
    });
  }

  it('passes an already-coded ManagerError through unchanged', async () => {
    const original = new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'no account');
    const handler = handlerFor(IPC_CHANNELS.minecraftRepair, () => Promise.reject(original));
    await expect(handler('vanilla')).rejects.toBe(original);
  });

  it('leaves a non-kit error untouched so the IPC boundary handles it', async () => {
    const original = new Error('generic boom');
    const handler = handlerFor(IPC_CHANNELS.minecraftLaunch, () => Promise.reject(original));
    await expect(handler('vanilla')).rejects.toBe(original);
  });
});
