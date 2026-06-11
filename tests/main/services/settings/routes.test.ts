import type { LauncherSettings } from '@shared/contracts/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

const systemMock = vi.hoisted(() => ({
  directoryHasEntries: vi.fn(async () => false),
  pickFolderWithSuffix: vi.fn(async () => null as { path: string } | null),
}));

vi.mock('@main/infra/system', () => systemMock);

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchLauncherSettings: vi.fn(),
  setClientOverride: vi.fn(),
  clearClientOverride: vi.fn(),
}));

vi.mock('@main/services/settings/settings', () => settingsMock);

import type { Router } from '@main/ipc/router';
import { registerSettingsRoutes } from '@main/services/settings/routes';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS, type IpcArgs, type IpcContract, type IpcResult } from '@shared/ipc';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

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

const SETTINGS: LauncherSettings = {
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder: '/clients' },
  launch: { console: false, fullscreen: false },
  clients: {},
};

const registerWith = () => {
  const { router, handlers } = createTestRouter();
  registerSettingsRoutes(router, () => ({}) as BrowserWindow);
  return handlers;
};

beforeEach(() => {
  appMock.isPackaged = false;
  settingsMock.getSettings.mockReturnValue(SETTINGS);
  settingsMock.patchLauncherSettings.mockReturnValue(SETTINGS);
  settingsMock.setClientOverride.mockReturnValue(SETTINGS);
  settingsMock.clearClientOverride.mockReturnValue(SETTINGS);
});

afterEach(() => {
  vi.clearAllMocks();
  appMock.isPackaged = false;
});

// Most settings routes register synchronous handlers, so a failed
// parseIpcArgs/assertNoIpcArgs throws synchronously rather than rejecting a
// promise. The fake test router does not wrap handlers the way the real router
// does, so capture both throw shapes.
const captureThrow = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to throw');
};

describe('registerSettingsRoutes', () => {
  it('settings.get rejects any payload (no args)', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() => handlers.get(IPC_CHANNELS.settingsGet)?.({ x: 1 }));
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.getSettings).not.toHaveBeenCalled();
  });

  it('settings.get returns settings for an undefined payload', () => {
    const handlers = registerWith();
    expect(handlers.get(IPC_CHANNELS.settingsGet)?.(undefined)).toBe(SETTINGS);
    expect(settingsMock.getSettings).toHaveBeenCalledTimes(1);
  });

  it('settings.setLauncher forwards a valid partial patch', async () => {
    const handlers = registerWith();
    const patch = { memory: { allocatedRamMb: 4096 } };
    await handlers.get(IPC_CHANNELS.settingsSetLauncher)?.(patch);
    expect(settingsMock.patchLauncherSettings).toHaveBeenCalledWith(patch);
  });

  it('settings.setLauncher rejects an extra key (strict schema) without calling the service', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsSetLauncher)?.({
        memory: { allocatedRamMb: 4096 },
        bogus: 1,
      }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.patchLauncherSettings).not.toHaveBeenCalled();
  });

  it('settings.setClientOverride forwards the parsed slug and patch', async () => {
    const handlers = registerWith();
    await handlers.get(IPC_CHANNELS.settingsSetClientOverride)?.({
      slug: 'vanilla',
      patch: { memory: { allocatedRamMb: 1024 } },
    });
    expect(settingsMock.setClientOverride).toHaveBeenCalledWith('vanilla', {
      memory: { allocatedRamMb: 1024 },
    });
  });

  it('settings.setClientOverride rejects a missing patch', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsSetClientOverride)?.({ slug: 'vanilla' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.setClientOverride).not.toHaveBeenCalled();
  });

  it('settings.clearClientOverrides forwards a valid slug', async () => {
    const handlers = registerWith();
    await handlers.get(IPC_CHANNELS.settingsClearClientOverrides)?.('vanilla');
    expect(settingsMock.clearClientOverride).toHaveBeenCalledWith('vanilla');
  });

  it('settings.clearClientOverrides rejects a non-string slug', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsClearClientOverrides)?.(7),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.clearClientOverride).not.toHaveBeenCalled();
  });

  it('settings.chooseClientFolder returns null when the user cancels the picker', async () => {
    systemMock.pickFolderWithSuffix.mockResolvedValueOnce(null);
    const handlers = registerWith();
    await expect(handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.('vanilla')).resolves.toBe(
      null,
    );
    expect(settingsMock.setClientOverride).not.toHaveBeenCalled();
  });

  it('settings.chooseClientFolder persists the picked folder and reports install presence', async () => {
    systemMock.pickFolderWithSuffix.mockResolvedValueOnce({ path: '/picked' });
    systemMock.directoryHasEntries.mockResolvedValueOnce(true);
    const handlers = registerWith();
    const result = await handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.('vanilla');
    expect(settingsMock.setClientOverride).toHaveBeenCalledWith('vanilla', {
      storage: { clientFolder: '/picked' },
    });
    expect(result).toEqual({ settings: SETTINGS, installed: true });
  });

  it('settings.chooseClientFolder rejects a non-string slug before opening the picker', async () => {
    const handlers = registerWith();
    await expect(
      handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.(null),
    ).rejects.toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(systemMock.pickFolderWithSuffix).not.toHaveBeenCalled();
  });
});
