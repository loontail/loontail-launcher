import { IPC_ERROR_SENTINEL, isIpcError, tryUnwrapIpcError } from '@shared/ipc';
import { describe, expect, it } from 'vitest';

const wrap = (payload: unknown): string => `${IPC_ERROR_SENTINEL}${JSON.stringify(payload)}`;

describe('isIpcError', () => {
  it('accepts any non-empty string code, not just the registry', () => {
    expect(isIpcError({ code: 'opInFlight', message: 'busy' })).toBe(true);
    expect(isIpcError({ code: 'IPC_HANDLER_FAILED', message: 'boom' })).toBe(true);
  });

  it('rejects shapes missing a usable code or message', () => {
    expect(isIpcError({ code: '', message: 'no code' })).toBe(false);
    expect(isIpcError({ code: 'x' })).toBe(false);
    expect(isIpcError({ message: 'no code' })).toBe(false);
    expect(isIpcError(null)).toBe(false);
    expect(isIpcError('opInFlight')).toBe(false);
  });
});

describe('tryUnwrapIpcError', () => {
  it('rehydrates a payload whose code is not in ERROR_CODES', () => {
    const unwrapped = tryUnwrapIpcError(
      wrap({ code: 'noClientFolder', message: 'No client folder configured' }),
    );
    expect(unwrapped).toEqual({ code: 'noClientFolder', message: 'No client folder configured' });
  });

  it('preserves details when present', () => {
    const unwrapped = tryUnwrapIpcError(
      wrap({ code: 'IPC_INVALID_ARGS', message: 'bad', details: { field: 'key' } }),
    );
    expect(unwrapped).toEqual({
      code: 'IPC_INVALID_ARGS',
      message: 'bad',
      details: { field: 'key' },
    });
  });

  it('returns null when the sentinel is absent', () => {
    expect(tryUnwrapIpcError('Error invoking remote method: [object Object]')).toBeNull();
  });

  it('returns null when the embedded payload is not an IpcError shape', () => {
    expect(tryUnwrapIpcError(wrap({ message: 'no code' }))).toBeNull();
  });
});
