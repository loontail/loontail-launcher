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

import { registerSystemRoutes } from '@main/services/system/routes';
import { asClientSlug } from '@shared/contracts/ids';
import { IPC_CHANNELS } from '@shared/ipc';
import { type StoredHandler, createTestRouter } from '../../../helpers/router';

const getOpenPathHandler = (handlers: Map<string, StoredHandler>): StoredHandler => {
  const handler = handlers.get(IPC_CHANNELS.systemOpenPath);
  if (!handler) throw new Error('system.openPath handler was not registered');
  return handler;
};

const makeSettings = (
  clientsFolder: string,
  clientFolder: string,
  runtimePath: string,
): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder },
  launch: { console: false, fullscreen: false },
  clients: {
    [asClientSlug('vanilla')]: {
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
