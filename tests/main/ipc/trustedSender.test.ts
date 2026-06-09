import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { RENDERER_ENTRY_FILES } from '@main/windows/rendererLocations';
import { CONSOLE_TRUSTED_CHANNELS, IPC_CHANNELS, type IpcContract } from '@shared/ipc';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it } from 'vitest';

const consoleWindowState = {
  current: null as BrowserWindow | null,
};

const consoleHub = { getWindow: () => consoleWindowState.current } as unknown as ConsoleHub;

const rendererRoot = join(process.cwd(), 'out', 'renderer');
const mainFileUrl = pathToFileURL(join(rendererRoot, RENDERER_ENTRY_FILES.Main)).href;
const consoleFileUrl = pathToFileURL(join(rendererRoot, RENDERER_ENTRY_FILES.Console)).href;
const arbitraryFileUrl = pathToFileURL(join(process.cwd(), 'outside.html')).href;

const fakeWindow = (id: number): BrowserWindow =>
  ({
    webContents: { id },
  }) as unknown as BrowserWindow;

const fakeEvent = (
  senderId: number,
  url: string,
  parent: unknown | null = null,
): IpcMainInvokeEvent =>
  ({
    sender: { id: senderId },
    senderFrame: { url, parent },
  }) as unknown as IpcMainInvokeEvent;

beforeEach(() => {
  consoleWindowState.current = null;
});

describe('createTrustedSenderCheck', () => {
  it('trusts the main window only at the main renderer entry', () => {
    const mainWindow = fakeWindow(1);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(1, mainFileUrl), IPC_CHANNELS.authLogin)).toBe(true);
    expect(isTrusted(fakeEvent(1, arbitraryFileUrl), IPC_CHANNELS.authLogin)).toBe(false);
    expect(isTrusted(fakeEvent(1, consoleFileUrl), IPC_CHANNELS.authLogin)).toBe(false);
  });

  it('trusts the console window only at the console renderer entry', () => {
    const mainWindow = fakeWindow(1);
    consoleWindowState.current = fakeWindow(2);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(true);
    expect(isTrusted(fakeEvent(2, mainFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(false);
    expect(isTrusted(fakeEvent(2, arbitraryFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(false);
  });

  it('denies the console window any channel outside the console group', () => {
    const mainWindow = fakeWindow(1);
    consoleWindowState.current = fakeWindow(2);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.consoleCopyText)).toBe(true);
    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.authLogin)).toBe(false);
    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.minecraftLaunch)).toBe(false);
    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.systemOpenPath)).toBe(false);
  });

  it('rejects child frames even when their URL matches an allowed entry', () => {
    const mainWindow = fakeWindow(1);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(1, mainFileUrl, {}), IPC_CHANNELS.authLogin)).toBe(false);
  });

  it('grants the console window exactly the explicit allowlist and nothing else', () => {
    const mainWindow = fakeWindow(1);
    consoleWindowState.current = fakeWindow(2);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    const allChannels = Object.values(IPC_CHANNELS) as Array<keyof IpcContract>;
    for (const channel of allChannels) {
      const expected = CONSOLE_TRUSTED_CHANNELS.has(channel);
      expect(isTrusted(fakeEvent(2, consoleFileUrl), channel)).toBe(expected);
    }
  });

  it('keeps the console allowlist scoped to the four console channels', () => {
    expect([...CONSOLE_TRUSTED_CHANNELS].sort()).toEqual(
      [
        IPC_CHANNELS.consoleGetInitial,
        IPC_CHANNELS.consoleClear,
        IPC_CHANNELS.consoleCopyAll,
        IPC_CHANNELS.consoleCopyText,
      ].sort(),
    );
  });

  it('uses the currently attached console window after reopening', () => {
    const mainWindow = fakeWindow(1);
    const isTrusted = createTrustedSenderCheck(() => mainWindow, consoleHub, {
      rendererRoot,
      devServerUrl: null,
    });

    consoleWindowState.current = fakeWindow(2);
    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(true);

    consoleWindowState.current = fakeWindow(3);
    expect(isTrusted(fakeEvent(2, consoleFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(false);
    expect(isTrusted(fakeEvent(3, consoleFileUrl), IPC_CHANNELS.consoleGetInitial)).toBe(true);
  });
});
