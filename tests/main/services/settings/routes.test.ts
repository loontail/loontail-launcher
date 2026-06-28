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

import { registerSettingsRoutes } from '@main/services/settings/routes';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';
import { captureThrow, createTestRouter } from '../../../helpers/router';

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

  it('settings.setClientOverride forwards the parsed CatalogKey and patch', async () => {
    const handlers = registerWith();
    await handlers.get(IPC_CHANNELS.settingsSetClientOverride)?.({
      slug: 'official:vanilla',
      patch: { memory: { allocatedRamMb: 1024 } },
    });
    expect(settingsMock.setClientOverride).toHaveBeenCalledWith('official:vanilla', {
      memory: { allocatedRamMb: 1024 },
    });
  });

  it('settings.setClientOverride rejects a bare slug', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsSetClientOverride)?.({
        slug: 'vanilla',
        patch: { memory: { allocatedRamMb: 1024 } },
      }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.setClientOverride).not.toHaveBeenCalled();
  });

  it('settings.setClientOverride rejects a missing patch', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsSetClientOverride)?.({ slug: 'official:vanilla' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.setClientOverride).not.toHaveBeenCalled();
  });

  it('settings.clearClientOverrides forwards a valid CatalogKey', async () => {
    const handlers = registerWith();
    await handlers.get(IPC_CHANNELS.settingsClearClientOverrides)?.('official:vanilla');
    expect(settingsMock.clearClientOverride).toHaveBeenCalledWith('official:vanilla');
  });

  it('settings.clearClientOverrides rejects a bare slug', async () => {
    const handlers = registerWith();
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.settingsClearClientOverrides)?.('vanilla'),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(settingsMock.clearClientOverride).not.toHaveBeenCalled();
  });

  it('settings.clearClientOverrides rejects a non-string key', async () => {
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
    await expect(
      handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.('official:vanilla'),
    ).resolves.toBe(null);
    expect(settingsMock.setClientOverride).not.toHaveBeenCalled();
  });

  it('settings.chooseClientFolder uses the bare ref as the folder suffix, not the CatalogKey', async () => {
    systemMock.pickFolderWithSuffix.mockResolvedValueOnce({ path: '/picked' });
    systemMock.directoryHasEntries.mockResolvedValueOnce(true);
    const handlers = registerWith();
    const result = await handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.(
      'official:vanilla',
    );
    // The picker suffix is the bare slug (`vanilla`), never `official:vanilla`:
    // `:` is illegal in a Windows path segment.
    expect(systemMock.pickFolderWithSuffix).toHaveBeenCalledWith(expect.anything(), 'vanilla');
    // The settings record still keys by the CatalogKey.
    expect(settingsMock.setClientOverride).toHaveBeenCalledWith('official:vanilla', {
      storage: { clientFolder: '/picked' },
    });
    expect(result).toEqual({ settings: SETTINGS, installed: true });
  });

  it('settings.chooseClientFolder uses the bare uuid suffix for a local build', async () => {
    systemMock.pickFolderWithSuffix.mockResolvedValueOnce({ path: '/picked' });
    systemMock.directoryHasEntries.mockResolvedValueOnce(false);
    const handlers = registerWith();
    const localKey = 'local:550e8400-e29b-41d4-a716-446655440000';
    await handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.(localKey);
    expect(systemMock.pickFolderWithSuffix).toHaveBeenCalledWith(
      expect.anything(),
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(settingsMock.setClientOverride).toHaveBeenCalledWith(localKey, {
      storage: { clientFolder: '/picked' },
    });
  });

  it('settings.chooseClientFolder rejects a bare slug before opening the picker', async () => {
    const handlers = registerWith();
    await expect(
      handlers.get(IPC_CHANNELS.settingsChooseClientFolder)?.('vanilla'),
    ).rejects.toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(systemMock.pickFolderWithSuffix).not.toHaveBeenCalled();
  });
});
