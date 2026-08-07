import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AutoUpdaterEvent =
  | 'checking-for-update'
  | 'update-not-available'
  | 'update-available'
  | 'update-downloaded'
  | 'error';

const autoUpdaterMock = vi.hoisted(() => {
  const listeners = new Map<AutoUpdaterEvent, Set<(...args: unknown[]) => void>>();
  return {
    listeners,
    setFeedURL: vi.fn<(options: { url: string }) => void>(),
    checkForUpdates: vi.fn<() => void>(),
    quitAndInstall: vi.fn<() => void>(),
    on: vi.fn((event: AutoUpdaterEvent, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }),
    removeListener: vi.fn((event: AutoUpdaterEvent, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: (event: AutoUpdaterEvent, ...args: unknown[]): void => {
      for (const handler of listeners.get(event) ?? []) handler(...args);
    },
    reset: (): void => {
      listeners.clear();
      autoUpdaterMock.setFeedURL.mockReset();
      autoUpdaterMock.checkForUpdates.mockReset();
      autoUpdaterMock.quitAndInstall.mockReset();
      autoUpdaterMock.on.mockClear();
      autoUpdaterMock.removeListener.mockClear();
    },
  };
});

const appMock = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: vi.fn(() => '1.0.0'),
}));

vi.mock('electron', () => ({
  app: appMock,
  autoUpdater: autoUpdaterMock,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createUpdaterService } from '@main/services/updater';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import type { BrowserWindow } from 'electron';
import { createTestRouter, type StoredHandler } from '../../../helpers/router';

const makeWindow = (sent: UpdaterStatusEvent[]): BrowserWindow =>
  ({
    isDestroyed: () => false,
    webContents: { send: (_channel: string, payload: UpdaterStatusEvent) => sent.push(payload) },
  }) as unknown as BrowserWindow;

const getCheckHandler = (handlers: Map<string, StoredHandler>): StoredHandler => {
  const handler = handlers.get('updater.check');
  if (!handler) throw new Error('updater.check handler was not registered');
  return handler;
};

let platformDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  autoUpdaterMock.reset();
  appMock.isPackaged = true;
  appMock.getVersion.mockReturnValue('1.0.0');
  platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
});

describe('createUpdaterService watchdog', () => {
  it('resets in-flight and broadcasts ERROR when a check stalls past the timeout', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.CHECKING });

    vi.advanceTimersByTime(60_000);

    expect(sent.at(-1)).toEqual({
      state: UpdaterStates.ERROR,
      message: 'Update check timed out',
    });

    autoUpdaterMock.checkForUpdates.mockClear();
    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('disarms the watchdog on update-available so the download phase never false-fires', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    autoUpdaterMock.emit('update-available');
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.AVAILABLE });

    vi.advanceTimersByTime(120_000);

    expect(sent.some((event) => event.state === UpdaterStates.ERROR)).toBe(false);
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.AVAILABLE });
  });

  it('broadcasts AVAILABLE without a version (Squirrel never provides one)', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    autoUpdaterMock.emit('update-available');

    const available = sent.at(-1);
    expect(available).toEqual({ state: UpdaterStates.AVAILABLE });
    expect(available && 'version' in available).toBe(false);
  });

  it('disarms the watchdog on dispose so a stalled timer cannot fire later', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    await service.dispose();

    vi.advanceTimersByTime(120_000);

    expect(sent.some((event) => event.state === UpdaterStates.ERROR)).toBe(false);
  });
});

describe('createUpdaterService registered gate', () => {
  it('broadcasts a terminal state when registration failed (setFeedURL threw)', async () => {
    autoUpdaterMock.setFeedURL.mockImplementation(() => {
      throw new Error('feed url rejected');
    });
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.NOT_AVAILABLE });
  });
});

describe('createUpdaterService lifecycle broadcasts', () => {
  it('broadcasts CHECKING then AVAILABLE then READY across the full update cycle', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit('checking-for-update');
    autoUpdaterMock.emit('update-available');
    autoUpdaterMock.emit('update-downloaded', undefined, 'notes', '2.0.0');

    expect(sent).toEqual([
      { state: UpdaterStates.CHECKING },
      { state: UpdaterStates.AVAILABLE },
      { state: UpdaterStates.READY, version: '2.0.0' },
    ]);
  });

  it('falls back to the running app version when update-downloaded carries no release name', async () => {
    appMock.getVersion.mockReturnValue('1.4.2');
    const sent: UpdaterStatusEvent[] = [];
    const { router } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    autoUpdaterMock.emit('update-downloaded', undefined, 'notes', '');

    expect(sent.at(-1)).toEqual({ state: UpdaterStates.READY, version: '1.4.2' });
  });

  it('clears in-flight after READY so a subsequent check runs again', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    autoUpdaterMock.emit('update-downloaded', undefined, 'notes', '2.0.0');

    autoUpdaterMock.checkForUpdates.mockClear();
    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('broadcasts NOT_AVAILABLE and clears in-flight when no update is found', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    autoUpdaterMock.emit('update-not-available');
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.NOT_AVAILABLE });

    autoUpdaterMock.checkForUpdates.mockClear();
    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('broadcasts ERROR and clears in-flight when autoUpdater emits error', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    autoUpdaterMock.emit('error', new Error('network down'));
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.ERROR, message: 'network down' });

    autoUpdaterMock.checkForUpdates.mockClear();
    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('createUpdaterService in-flight gate', () => {
  it('skips a second check that lands before Squirrel emits checking-for-update', async () => {
    // The flag must be claimed at the call site: `checking-for-update` arrives a
    // tick later, so two invokes in the same tick would both spawn Update.exe.
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await Promise.all([getCheckHandler(handlers)(undefined), getCheckHandler(handlers)(undefined)]);

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight on an error event so a later check runs again', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit('error', new Error('feed unreachable'));
    await getCheckHandler(handlers)(undefined);

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('skips a second check while a check is already in flight', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    await getCheckHandler(handlers)(undefined);
    autoUpdaterMock.emit('checking-for-update');
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    await getCheckHandler(handlers)(undefined);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('createUpdaterService non-Squirrel', () => {
  it('replies NOT_AVAILABLE without registering listeners on a non-packaged build', async () => {
    appMock.isPackaged = false;
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdaterMock.on).not.toHaveBeenCalled();

    await getCheckHandler(handlers)(undefined);

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ state: UpdaterStates.NOT_AVAILABLE });
  });

  it('does not install when invoked on a non-Squirrel platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const sent: UpdaterStatusEvent[] = [];
    const { router, handlers } = createTestRouter();
    const service = createUpdaterService(router, () => makeWindow(sent));
    await service.init();

    const install = handlers.get('updater.install');
    if (!install) throw new Error('updater.install handler was not registered');
    await install(undefined);

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('createUpdaterService broadcast guard', () => {
  it('skips sending to a destroyed window', async () => {
    const sent: UpdaterStatusEvent[] = [];
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: {
        send: (_channel: string, payload: UpdaterStatusEvent) => sent.push(payload),
      },
    } as unknown as BrowserWindow;
    const { router } = createTestRouter();
    const service = createUpdaterService(router, () => destroyedWindow);
    await service.init();

    autoUpdaterMock.emit('update-available');

    expect(sent).toHaveLength(0);
  });
});
