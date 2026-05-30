import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, IpcHandler>());

type IpcHandler = (event: IpcMainInvokeEvent, args: unknown) => unknown;

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: appMock,
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string): void => {
      handlers.delete(channel);
    },
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

import { createRouter } from '@main/ipc/router';
import { BundleError } from '@main/services/bundle/errors';
import { ManagerError } from '@main/services/minecraft/errors';
import { SkinError } from '@main/services/skin/errors';
import { ERROR_CODES } from '@shared/constants';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { IPC_ERROR_SENTINEL, tryUnwrapIpcError } from '@shared/ipc';

const fakeEvent = (): IpcMainInvokeEvent => ({}) as unknown as IpcMainInvokeEvent;

beforeEach(() => {
  handlers.clear();
  loggerMocks.error.mockClear();
  appMock.isPackaged = false;
});

afterEach(() => {
  handlers.clear();
});

describe('createRouter', () => {
  it('passes through handler results when the sender is trusted', async () => {
    const router = createRouter(() => true);
    router.handle('app.getVersion', () => '1.2.3');

    const handler = handlers.get('app.getVersion');
    expect(handler).toBeDefined();
    const result = await handler?.(fakeEvent(), undefined);
    expect(result).toBe('1.2.3');
  });

  it('rejects untrusted senders with IPC_UNTRUSTED_SENDER', async () => {
    const router = createRouter(() => false);
    const handlerImpl = vi.fn(() => 'ok');
    router.handle('app.getVersion', handlerImpl);

    const handler = handlers.get('app.getVersion');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }

    expect(handlerImpl).not.toHaveBeenCalled();
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message.startsWith(IPC_ERROR_SENTINEL)).toBe(true);
    const ipcError = tryUnwrapIpcError(message);
    expect(ipcError?.code).toBe(ERROR_CODES.IpcUntrustedSender);
  });

  it('wraps thrown Errors as IPC_HANDLER_FAILED with dev stack details', async () => {
    appMock.isPackaged = false;
    const router = createRouter(() => true);
    router.handle('app.getVersion', () => {
      throw new Error('boom');
    });

    const handler = handlers.get('app.getVersion');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }

    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError?.code).toBe(ERROR_CODES.IpcHandlerFailed);
    expect(ipcError?.message).toBe('boom');
    expect(ipcError?.details).toMatchObject({ stack: expect.any(String) });
  });

  it('omits dev details when packaged', async () => {
    appMock.isPackaged = true;
    const router = createRouter(() => true);
    router.handle('app.getVersion', () => {
      throw new Error('boom');
    });

    const handler = handlers.get('app.getVersion');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }
    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError?.details).toBeUndefined();
  });

  it('preserves a thrown IpcError shape ({code, message})', async () => {
    const router = createRouter(() => true);
    router.handle('app.getVersion', () => {
      throw { code: ERROR_CODES.IpcInvalidArgs, message: 'bad args' };
    });

    const handler = handlers.get('app.getVersion');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }
    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError?.code).toBe(ERROR_CODES.IpcInvalidArgs);
    expect(ipcError?.message).toBe('bad args');
  });

  it('preserves the message of a thrown Error subclass (SkinError)', async () => {
    appMock.isPackaged = true;
    const router = createRouter(() => true);
    router.handle('media.uploadSkin', () => {
      throw new SkinError(ERROR_CODES.SkinUploadFailed, 'Skin upload rejected');
    });

    const handler = handlers.get('media.uploadSkin');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }

    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError).toEqual({
      code: ERROR_CODES.SkinUploadFailed,
      message: 'Skin upload rejected',
    });
  });

  it('rehydrates a domain error code outside ERROR_CODES (minecraft.install OP_IN_FLIGHT)', async () => {
    appMock.isPackaged = true;
    const router = createRouter(() => true);
    router.handle('minecraft.install', () => {
      throw new ManagerError(MinecraftErrorCodes.OP_IN_FLIGHT, 'Operation already running');
    });

    const handler = handlers.get('minecraft.install');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }

    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError).toEqual({
      code: MinecraftErrorCodes.OP_IN_FLIGHT,
      message: 'Operation already running',
    });
  });

  it('rehydrates a thrown BundleError (bundle.start NO_CLIENT_FOLDER)', async () => {
    appMock.isPackaged = true;
    const router = createRouter(() => true);
    router.handle('bundle.start', () => {
      throw new BundleError(BundleErrorCodes.NO_CLIENT_FOLDER, 'No client folder configured');
    });

    const handler = handlers.get('bundle.start');
    let captured: unknown;
    try {
      await handler?.(fakeEvent(), undefined);
    } catch (error) {
      captured = error;
    }

    const ipcError = tryUnwrapIpcError((captured as Error).message);
    expect(ipcError).toEqual({
      code: BundleErrorCodes.NO_CLIENT_FOLDER,
      message: 'No client folder configured',
    });
  });

  it('dispose() removes every registered channel', () => {
    const router = createRouter(() => true);
    router.handle('app.getVersion', () => '1.0.0');
    router.handle('auth.logout', () => undefined);
    expect(handlers.size).toBe(2);

    router.dispose();
    expect(handlers.size).toBe(0);
  });
});
