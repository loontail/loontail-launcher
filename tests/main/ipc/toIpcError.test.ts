import { MinecraftKitError, MinecraftKitErrorCodes } from '@loontail/minecraft-kit';
import { YggdrasilClientError, YggdrasilClientErrorCodes } from '@loontail/yggdrasil-client';
import { BundleError } from '@main/services/bundle/errors';
import { ManagerError } from '@main/services/minecraft/errors';
import { SkinError } from '@main/services/skin/errors';
import { ERROR_CODES } from '@shared/constants';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { SkinErrorCodes } from '@shared/contracts/skin';
import { afterEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: true }));

vi.mock('electron', () => ({ app: appMock }));

import { toIpcError } from '@main/ipc/toIpcError';

afterEach(() => {
  appMock.isPackaged = true;
});

describe('toIpcError', () => {
  it('maps a kit error to IPC_HANDLER_FAILED and keeps the kit code off the wire', () => {
    const error = new MinecraftKitError(MinecraftKitErrorCodes.MANIFEST_NOT_FOUND, 'manifest gone');
    expect(toIpcError(error)).toEqual({
      code: ERROR_CODES.IpcHandlerFailed,
      message: 'manifest gone',
    });
  });

  it('passes a ManagerError code and message through unchanged', () => {
    const error = new ManagerError(MinecraftErrorCodes.OP_IN_FLIGHT, 'Operation already running');
    expect(toIpcError(error)).toEqual({
      code: MinecraftErrorCodes.OP_IN_FLIGHT,
      message: 'Operation already running',
    });
  });

  it('passes a BundleError code and message through unchanged', () => {
    const error = new BundleError(BundleErrorCodes.NO_CLIENT_FOLDER, 'No client folder configured');
    expect(toIpcError(error)).toEqual({
      code: BundleErrorCodes.NO_CLIENT_FOLDER,
      message: 'No client folder configured',
    });
  });

  it('passes a SkinError code and message through unchanged', () => {
    const error = new SkinError(SkinErrorCodes.UPLOAD_FAILED, 'Upload failed');
    expect(toIpcError(error)).toEqual({
      code: SkinErrorCodes.UPLOAD_FAILED,
      message: 'Upload failed',
    });
  });

  it('passes a Yggdrasil client error code through unchanged', () => {
    const error = new YggdrasilClientError(YggdrasilClientErrorCodes.NETWORK, 'offline');
    expect(toIpcError(error)).toEqual({
      code: YggdrasilClientErrorCodes.NETWORK,
      message: 'offline',
    });
  });

  it('preserves an already-structured IpcError, including its details', () => {
    expect(
      toIpcError({
        code: ERROR_CODES.IpcInvalidArgs,
        message: 'bad args',
        details: { field: 'slug' },
      }),
    ).toEqual({
      code: ERROR_CODES.IpcInvalidArgs,
      message: 'bad args',
      details: { field: 'slug' },
    });
  });

  it('maps a bare Error to IPC_HANDLER_FAILED with its message', () => {
    expect(toIpcError(new Error('boom'))).toEqual({
      code: ERROR_CODES.IpcHandlerFailed,
      message: 'boom',
    });
  });

  it('collapses a non-Error value to UNKNOWN', () => {
    expect(toIpcError('nope')).toEqual({ code: ERROR_CODES.Unknown, message: 'Unknown error' });
  });

  it('attaches dev details (stack + kit code) only when not packaged', () => {
    appMock.isPackaged = false;
    const result = toIpcError(
      new MinecraftKitError(MinecraftKitErrorCodes.MANIFEST_NOT_FOUND, 'gone'),
    );
    expect(result.code).toBe(ERROR_CODES.IpcHandlerFailed);
    expect(result.message).toBe('gone');
    expect(result.details).toMatchObject({
      kitCode: MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
      stack: expect.any(String),
    });
  });
});
