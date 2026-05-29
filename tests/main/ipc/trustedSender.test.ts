import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consoleWindowState = vi.hoisted(() => ({
  current: null as BrowserWindow | null,
}));

vi.mock('@main/infra/consoleHub', () => ({
  consoleHub: {
    getWindow: () => consoleWindowState.current,
  },
}));

import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { RENDERER_ENTRY_FILES } from '@main/windows/rendererLocations';

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
    const isTrusted = createTrustedSenderCheck(mainWindow, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(1, mainFileUrl))).toBe(true);
    expect(isTrusted(fakeEvent(1, arbitraryFileUrl))).toBe(false);
    expect(isTrusted(fakeEvent(1, consoleFileUrl))).toBe(false);
  });

  it('trusts the console window only at the console renderer entry', () => {
    const mainWindow = fakeWindow(1);
    consoleWindowState.current = fakeWindow(2);
    const isTrusted = createTrustedSenderCheck(mainWindow, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(2, consoleFileUrl))).toBe(true);
    expect(isTrusted(fakeEvent(2, mainFileUrl))).toBe(false);
    expect(isTrusted(fakeEvent(2, arbitraryFileUrl))).toBe(false);
  });

  it('rejects child frames even when their URL matches an allowed entry', () => {
    const mainWindow = fakeWindow(1);
    const isTrusted = createTrustedSenderCheck(mainWindow, {
      rendererRoot,
      devServerUrl: null,
    });

    expect(isTrusted(fakeEvent(1, mainFileUrl, {}))).toBe(false);
  });

  it('uses the currently attached console window after reopening', () => {
    const mainWindow = fakeWindow(1);
    const isTrusted = createTrustedSenderCheck(mainWindow, {
      rendererRoot,
      devServerUrl: null,
    });

    consoleWindowState.current = fakeWindow(2);
    expect(isTrusted(fakeEvent(2, consoleFileUrl))).toBe(true);

    consoleWindowState.current = fakeWindow(3);
    expect(isTrusted(fakeEvent(2, consoleFileUrl))).toBe(false);
    expect(isTrusted(fakeEvent(3, consoleFileUrl))).toBe(true);
  });
});
