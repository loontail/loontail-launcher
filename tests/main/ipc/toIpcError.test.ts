import { MinecraftKitError, MinecraftKitErrorCodes } from '@loontail/minecraft-kit';
import { BundleError } from '@main/services/bundle/errors';
import { MinecraftError } from '@main/services/minecraft/errors';
import { SkinError } from '@main/services/skin/errors';
import { ERROR_CODES } from '@shared/constants';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { SkinErrorCodes } from '@shared/contracts/skin';
import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
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
      code: ERROR_CODES.IPC_HANDLER_FAILED,
      message: 'manifest gone',
    });
  });

  it('passes a MinecraftError code and message through unchanged', () => {
    const error = new MinecraftError(MinecraftErrorCodes.OP_IN_FLIGHT, 'Operation already running');
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

  it('passes a Yggdrasil error code through unchanged', () => {
    const error = new YggdrasilError(YggdrasilErrorCodes.NETWORK, 'offline');
    expect(toIpcError(error)).toEqual({
      code: YggdrasilErrorCodes.NETWORK,
      message: 'offline',
    });
  });

  it('preserves an already-structured IpcError, including its details', () => {
    expect(
      toIpcError({
        code: ERROR_CODES.IPC_INVALID_ARGS,
        message: 'bad args',
        details: { field: 'key' },
      }),
    ).toEqual({
      code: ERROR_CODES.IPC_INVALID_ARGS,
      message: 'bad args',
      details: { field: 'key' },
    });
  });

  it('maps a bare Error to IPC_HANDLER_FAILED with its message', () => {
    expect(toIpcError(new Error('boom'))).toEqual({
      code: ERROR_CODES.IPC_HANDLER_FAILED,
      message: 'boom',
    });
  });

  it('routes a Node fs errno error to a generic message so the path never leaks', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open 'C:\\Users\\me\\secret\\instance.json'"),
      { code: 'ENOENT', errno: -4058, syscall: 'open', path: 'C:\\Users\\me\\secret' },
    );
    const result = toIpcError(error);
    expect(result.code).toBe(ERROR_CODES.IPC_HANDLER_FAILED);
    expect(result.message).toBe('Operation failed');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('collapses a non-Error value to UNKNOWN', () => {
    expect(toIpcError('nope')).toEqual({ code: ERROR_CODES.UNKNOWN, message: 'Unknown error' });
  });

  it('attaches dev details (stack + kit code) only when not packaged', () => {
    appMock.isPackaged = false;
    const result = toIpcError(
      new MinecraftKitError(MinecraftKitErrorCodes.MANIFEST_NOT_FOUND, 'gone'),
    );
    expect(result.code).toBe(ERROR_CODES.IPC_HANDLER_FAILED);
    expect(result.message).toBe('gone');
    expect(result.details).toMatchObject({
      kitCode: MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
      stack: expect.any(String),
    });
  });
});
