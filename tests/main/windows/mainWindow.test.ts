import type { ConsoleHub } from '@main/infra/consoleHub';
import type { App, BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
  app: {},
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { installMainWindowLifecycle } from '@main/windows/mainWindow';

type FakeWindow = BrowserWindow & {
  destroyed: boolean;
  minimized: boolean;
  emitClosed: () => void;
};

const makeFakeWindow = (): FakeWindow => {
  let closedHandler: (() => void) | null = null;
  const window = {
    destroyed: false,
    minimized: false,
    isDestroyed: () => window.destroyed,
    isMinimized: () => window.minimized,
    restore: vi.fn(() => {
      window.minimized = false;
    }),
    focus: vi.fn(),
    close: vi.fn(() => {
      window.destroyed = true;
      closedHandler?.();
    }),
    on: (event: string, handler: () => void) => {
      if (event === 'closed') closedHandler = handler;
    },
    emitClosed: () => {
      window.destroyed = true;
      closedHandler?.();
    },
  };
  return window as unknown as FakeWindow;
};

type FakeApp = Pick<App, 'on'> & { emit: (event: string) => void };

const makeFakeApp = (): FakeApp => {
  const handlers = new Map<string, () => void>();
  return {
    on: ((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return undefined as unknown as App;
    }) as App['on'],
    emit: (event) => handlers.get(event)?.(),
  };
};

const makeConsoleHub = (window: BrowserWindow | null): Pick<ConsoleHub, 'getWindow'> => ({
  getWindow: () => window,
});

describe('installMainWindowLifecycle', () => {
  let app: FakeApp;
  let mainWindow: FakeWindow;
  let createWindow: ReturnType<typeof vi.fn>;
  let attachNotifier: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = makeFakeApp();
    mainWindow = makeFakeWindow();
    createWindow = vi.fn(() => mainWindow);
    attachNotifier = vi.fn();
  });

  it('creates the window and attaches the notifier on install', () => {
    const holder = installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(null),
      createWindow,
      attachNotifier,
    });

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(attachNotifier).toHaveBeenCalledWith(mainWindow);
    expect(holder.get()).toBe(mainWindow);
  });

  it('closes the console window when the main window is closed', () => {
    const consoleWindow = makeFakeWindow();
    installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(consoleWindow),
      createWindow,
      attachNotifier,
    });

    mainWindow.emitClosed();

    expect(consoleWindow.close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the main window closes with no console open', () => {
    installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(null),
      createWindow,
      attachNotifier,
    });

    expect(() => mainWindow.emitClosed()).not.toThrow();
  });

  it('focuses the main window on second-instance, restoring it first when minimized', () => {
    installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(null),
      createWindow,
      attachNotifier,
    });
    mainWindow.minimized = true;

    app.emit('second-instance');

    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
  });

  it('ignores second-instance once the main window is destroyed', () => {
    installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(null),
      createWindow,
      attachNotifier,
    });
    mainWindow.destroyed = true;

    app.emit('second-instance');

    expect(mainWindow.focus).not.toHaveBeenCalled();
  });

  it('recreates and re-points the window on activate only when the main window is gone', () => {
    const holder = installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(null),
      createWindow,
      attachNotifier,
    });

    app.emit('activate');
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(holder.get()).toBe(mainWindow);

    mainWindow.destroyed = true;
    const recreated = makeFakeWindow();
    createWindow.mockReturnValueOnce(recreated);

    app.emit('activate');

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(attachNotifier).toHaveBeenLastCalledWith(recreated);
    expect(holder.get()).toBe(recreated);
  });

  it('couples the console close to the recreated window after a macOS re-open', () => {
    const consoleWindow = makeFakeWindow();
    const holder = installMainWindowLifecycle({
      app,
      consoleHub: makeConsoleHub(consoleWindow),
      createWindow,
      attachNotifier,
    });

    mainWindow.destroyed = true;
    const recreated = makeFakeWindow();
    createWindow.mockReturnValueOnce(recreated);
    app.emit('activate');

    holder.get();
    recreated.emitClosed();

    expect(consoleWindow.close).toHaveBeenCalledTimes(1);
  });
});
