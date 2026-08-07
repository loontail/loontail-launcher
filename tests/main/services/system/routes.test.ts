import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LauncherSettings } from '@shared/contracts/settings';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn<(name: string) => string>(),
  openPath: vi.fn<(targetPath: string) => Promise<string>>(),
  writeText: vi.fn<(text: string) => void>(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
    isPackaged: false,
  },
  clipboard: {
    writeText: electronMocks.writeText,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  shell: {
    openPath: electronMocks.openPath,
  },
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn<() => LauncherSettings>(),
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: settingsMock.getSettings,
}));

// getDiskSpace dynamically imports check-disk-space, which shells out to
// PowerShell on Windows — stub it so the allowlist is what's under test.
const checkDiskSpaceMock = vi.hoisted(() =>
  vi.fn(async (_path: string) => ({ diskPath: 'C:', free: 1_024, size: 4_096 })),
);

vi.mock('check-disk-space', () => ({ default: checkDiskSpaceMock }));

import { registerSystemRoutes } from '@main/services/system/routes';
import { asCatalogKey } from '@shared/contracts/ids';
import { SystemErrorCodes } from '@shared/contracts/system';
import { IPC_CHANNELS } from '@shared/ipc';
import { createTestRouter, type StoredHandler } from '../../../helpers/router';

const getHandler = (handlers: Map<string, StoredHandler>, channel: string): StoredHandler => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
};

const getOpenPathHandler = (handlers: Map<string, StoredHandler>): StoredHandler =>
  getHandler(handlers, IPC_CHANNELS.systemOpenPath);

const makeSettings = (
  clientsFolder: string,
  clientFolder: string,
  runtimePath: string,
): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder },
  launch: { console: false, fullscreen: false },
  clients: {
    [asCatalogKey('official:vanilla')]: {
      storage: { clientFolder },
      runtime: { component: 'jre-legacy', path: runtimePath },
    },
  },
});

// .native matches the source's `fs/promises` realpath (libuv): on Windows it
// expands 8.3 short names (e.g. RUNNER~1 -> runneradmin) while the JS
// fs.realpathSync does not, so the two diverge on CI runners with long
// usernames and the logged canonicalTarget would not match.
const makeDir = (root: string, name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync.native(dir);
};

let tempRoot = '';
let userData = '';
let clientsRoot = '';
let clientFolder = '';
let runtimePath = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-launcher-system-routes-'));
  userData = makeDir(tempRoot, 'userData');
  clientsRoot = makeDir(tempRoot, 'clients');
  clientFolder = makeDir(tempRoot, 'client-override');
  runtimePath = makeDir(tempRoot, 'runtime');

  electronMocks.getPath.mockImplementation((name) => {
    if (name === 'userData') return userData;
    throw new Error(`Unexpected app path: ${name}`);
  });
  electronMocks.openPath.mockResolvedValue('');
  electronMocks.writeText.mockClear();
  electronMocks.showOpenDialog.mockClear();
  checkDiskSpaceMock.mockClear();
  loggerMocks.warn.mockClear();
  settingsMock.getSettings.mockReturnValue(makeSettings(clientsRoot, clientFolder, runtimePath));
});

afterEach(() => {
  electronMocks.getPath.mockReset();
  electronMocks.openPath.mockReset();
  settingsMock.getSettings.mockReset();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('registerSystemRoutes', () => {
  it('does not register a renderer-reachable openExternal route', () => {
    const { router, handlers } = createTestRouter();

    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    expect(handlers.has('system.openExternal')).toBe(false);
  });

  it('opens only canonical launcher-owned paths', async () => {
    const defaultClientFolder = makeDir(clientsRoot, 'vanilla');
    const allowedTargets = [userData, defaultClientFolder, clientFolder, runtimePath];
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    const openPathHandler = getOpenPathHandler(handlers);
    for (const target of allowedTargets) {
      await openPathHandler(target);
    }

    expect(electronMocks.openPath).toHaveBeenCalledTimes(allowedTargets.length);
    for (const [index, target] of allowedTargets.entries()) {
      expect(electronMocks.openPath).toHaveBeenNthCalledWith(
        index + 1,
        fs.realpathSync.native(target),
      );
    }
  });

  it('refuses getFolderSize for a path outside launcher-owned roots without walking it', async () => {
    const outside = makeDir(tempRoot, 'outside-size');
    fs.writeFileSync(path.join(outside, 'big.bin'), Buffer.alloc(4096));
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    await expect(
      getHandler(handlers, IPC_CHANNELS.systemGetFolderSize)(outside),
    ).rejects.toMatchObject({ code: SystemErrorCodes.PATH_NOT_ALLOWED });
  });

  it('refuses getFolderSize for a traversal out of a launcher-owned root', async () => {
    makeDir(tempRoot, 'escaped');
    const traversal = path.join(clientsRoot, '..', 'escaped');
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    await expect(
      getHandler(handlers, IPC_CHANNELS.systemGetFolderSize)(traversal),
    ).rejects.toMatchObject({ code: SystemErrorCodes.PATH_NOT_ALLOWED });
  });

  it('sizes launcher-owned folders (userData, clients root, per-client override)', async () => {
    fs.writeFileSync(path.join(clientFolder, 'file.bin'), Buffer.alloc(2048));
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);
    const handler = getHandler(handlers, IPC_CHANNELS.systemGetFolderSize);

    await expect(handler(userData)).resolves.toEqual({ path: userData, bytes: 0 });
    await expect(handler(clientsRoot)).resolves.toEqual({ path: clientsRoot, bytes: 0 });
    await expect(handler(clientFolder)).resolves.toEqual({ path: clientFolder, bytes: 2048 });
  });

  it('refuses getDiskSpace outside launcher-owned roots and never probes the disk', async () => {
    const outside = makeDir(tempRoot, 'outside-disk');
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    await expect(
      getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace)(outside),
    ).rejects.toMatchObject({ code: SystemErrorCodes.PATH_NOT_ALLOWED });
    expect(checkDiskSpaceMock).not.toHaveBeenCalled();
  });

  it('reports disk space for a not-yet-created folder under a launcher-owned root', async () => {
    // The Settings/Setup UI asks for free space on a folder it is about to
    // create, so the check must canonicalize the nearest existing ancestor.
    const pending = path.join(clientsRoot, 'about-to-exist', 'nested');
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    await expect(getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace)(pending)).resolves.toEqual({
      path: pending,
      diskPath: 'C:',
      free: 1_024,
      size: 4_096,
    });
    expect(checkDiskSpaceMock).toHaveBeenCalledWith(pending);
  });

  it('addresses a folder the user just chose in the native dialog', async () => {
    // First-run setup reads free space and folder size for the picked folder
    // before it is saved to settings, so a dialog pick has to widen the roots.
    const picked = makeDir(tempRoot, 'picked');
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] });
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({ isDestroyed: () => false }) as BrowserWindow);

    await expect(
      getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace)(picked),
    ).rejects.toMatchObject({ code: SystemErrorCodes.PATH_NOT_ALLOWED });

    await getHandler(handlers, IPC_CHANNELS.systemPickInstallFolder)(undefined);

    await expect(
      getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace)(picked),
    ).resolves.toMatchObject({ free: 1_024 });
  });

  it('does not let a dialog pick widen the openPath allowlist', async () => {
    // A folder dialog can return a drive root; shell.openPath would then hand any
    // file under it to the OS default handler.
    const picked = makeDir(tempRoot, 'picked-open');
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] });
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({ isDestroyed: () => false }) as BrowserWindow);

    await getHandler(handlers, IPC_CHANNELS.systemPickInstallFolder)(undefined);
    await getOpenPathHandler(handlers)(picked);

    expect(electronMocks.openPath).not.toHaveBeenCalled();
  });

  it('forgets the previous pick once the user picks another folder', async () => {
    const abandoned = makeDir(tempRoot, 'abandoned');
    const chosen = makeDir(tempRoot, 'chosen');
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({ isDestroyed: () => false }) as BrowserWindow);
    const pick = getHandler(handlers, IPC_CHANNELS.systemPickInstallFolder);
    const diskSpace = getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace);

    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [abandoned] });
    await pick(undefined);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [chosen] });
    await pick(undefined);

    await expect(diskSpace(chosen)).resolves.toMatchObject({ free: 1_024 });
    await expect(diskSpace(abandoned)).rejects.toMatchObject({
      code: SystemErrorCodes.PATH_NOT_ALLOWED,
    });
  });

  it('shares one disk probe between identical concurrent requests', async () => {
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);
    const diskSpace = getHandler(handlers, IPC_CHANNELS.systemGetDiskSpace);

    const [first, second] = await Promise.all([diskSpace(clientsRoot), diskSpace(clientsRoot)]);

    expect(first).toBe(second);
    expect(checkDiskSpaceMock).toHaveBeenCalledTimes(1);
  });

  it('shares one folder walk between identical concurrent requests', async () => {
    // Each walk holds a slice of the libuv pool for up to 30 s, so a renderer loop
    // over the same path used to start one independent walk per invoke.
    fs.writeFileSync(path.join(clientFolder, 'file.bin'), Buffer.alloc(2048));
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);
    const folderSize = getHandler(handlers, IPC_CHANNELS.systemGetFolderSize);

    const [first, second] = await Promise.all([folderSize(clientFolder), folderSize(clientFolder)]);

    expect(first).toEqual({ path: clientFolder, bytes: 2048 });
    expect(first).toBe(second);
  });

  it('refuses arbitrary paths outside launcher-owned roots', async () => {
    const outsidePath = makeDir(tempRoot, 'outside');
    const { router, handlers } = createTestRouter();
    registerSystemRoutes(router, () => ({}) as BrowserWindow);

    await getOpenPathHandler(handlers)(outsidePath);

    expect(electronMocks.openPath).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Refused to open path outside launcher-owned roots',
      expect.objectContaining({
        canonicalTarget: fs.realpathSync.native(outsidePath),
        targetPath: outsidePath,
      }),
    );
  });
});
