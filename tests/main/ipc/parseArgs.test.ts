import { ERROR_CODES } from '@shared/constants';
import type { IpcError } from '@shared/ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  appMock.isPackaged = false;
});

const captureThrow = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('assertNoIpcArgs', () => {
  it('returns without throwing when rawArgs is undefined', () => {
    expect(() => assertNoIpcArgs(undefined, 'no args')).not.toThrow();
  });

  it('throws IPC_INVALID_ARGS when a payload is supplied', () => {
    const thrown = captureThrow(() =>
      assertNoIpcArgs({ malicious: true }, 'auth.me takes no arguments'),
    );
    expect(thrown).toEqual({
      code: ERROR_CODES.IPC_INVALID_ARGS,
      message: 'auth.me takes no arguments',
      details: { received: { malicious: true } },
    });
  });

  it('rejects null as a payload (only undefined is allowed)', () => {
    const thrown = captureThrow(() => assertNoIpcArgs(null, 'no args')) as IpcError;
    expect(thrown.code).toBe(ERROR_CODES.IPC_INVALID_ARGS);
  });

  it('omits dev details when packaged', () => {
    appMock.isPackaged = true;
    const thrown = captureThrow(() => assertNoIpcArgs('payload', 'no args')) as IpcError;
    expect(thrown).toEqual({ code: ERROR_CODES.IPC_INVALID_ARGS, message: 'no args' });
  });
});

describe('parseIpcArgs', () => {
  it('returns the parsed value on a valid payload', () => {
    expect(parseIpcArgs(z.string(), 'hello', 'must be a string')).toBe('hello');
  });

  it('throws IPC_INVALID_ARGS with formatted details in dev on a shape mismatch', () => {
    const thrown = captureThrow(() => parseIpcArgs(z.string(), 42, 'must be a string')) as IpcError;
    expect(thrown.code).toBe(ERROR_CODES.IPC_INVALID_ARGS);
    expect(thrown.message).toBe('must be a string');
    expect(thrown.details).toBeDefined();
  });

  it('omits details when packaged', () => {
    appMock.isPackaged = true;
    const thrown = captureThrow(() => parseIpcArgs(z.string(), 42, 'must be a string')) as IpcError;
    expect(thrown).toEqual({ code: ERROR_CODES.IPC_INVALID_ARGS, message: 'must be a string' });
  });
});
