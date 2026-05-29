import { MinecraftKitError, type MinecraftKitErrorCode } from '@loontail/minecraft-kit';
import { ManagerError, classifyError, errorMessage } from '@main/services/minecraft/errors';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const inactiveSignal = new AbortController().signal;

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe('ManagerError', () => {
  it('preserves the launcher error code and message', () => {
    const error = new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'no account');
    expect(error.code).toBe(MinecraftErrorCodes.NO_ACCOUNT);
    expect(error.message).toBe('no account');
    expect(error.name).toBe('ManagerError');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('classifyError', () => {
  // Each entry mirrors `KIT_CODE_TO_LAUNCHER_CODE` in errors.ts. A missing
  // entry here would mean the renderer falls back to a generic KIT_ERROR
  // toast — the whole point of having the map is to avoid that.
  const cases: Array<[MinecraftKitErrorCode, MinecraftErrorCode]> = [
    ['NETWORK_TIMEOUT', MinecraftErrorCodes.NETWORK_ERROR],
    ['NETWORK_HTTP_ERROR', MinecraftErrorCodes.NETWORK_ERROR],
    ['NETWORK_ABORTED', MinecraftErrorCodes.ABORTED],
    ['MANIFEST_NOT_FOUND', MinecraftErrorCodes.NETWORK_ERROR],
    ['INTEGRITY_HASH_MISMATCH', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['INTEGRITY_SIZE_MISMATCH', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['RUNTIME_NOT_FOUND', MinecraftErrorCodes.RUNTIME_ERROR],
    ['RUNTIME_UNSUPPORTED_PLATFORM', MinecraftErrorCodes.RUNTIME_ERROR],
    ['LAUNCH_JAVA_NOT_FOUND', MinecraftErrorCodes.RUNTIME_ERROR],
    ['LAUNCH_PROCESS_FAILED', MinecraftErrorCodes.LAUNCH_FAILED],
    ['LAUNCH_ABORTED', MinecraftErrorCodes.ABORTED],
  ];

  for (const [kitCode, launcherCode] of cases) {
    it(`maps kit ${kitCode} -> ${launcherCode}`, () => {
      const error = new MinecraftKitError(kitCode, kitCode);
      expect(classifyError(error)).toBe(launcherCode);
    });
  }

  it('falls back to KIT_ERROR for an unmapped kit code', () => {
    // AUTH_REFRESH_FAILED is a valid kit code that the launcher does not map.
    const error = new MinecraftKitError('AUTH_REFRESH_FAILED', 'refresh failed');
    expect(classifyError(error)).toBe(MinecraftErrorCodes.KIT_ERROR);
  });

  it('returns UNKNOWN for non-kit errors', () => {
    expect(classifyError(new Error('boom'))).toBe(MinecraftErrorCodes.UNKNOWN);
    expect(classifyError('string error')).toBe(MinecraftErrorCodes.UNKNOWN);
    expect(classifyError(null)).toBe(MinecraftErrorCodes.UNKNOWN);
  });

  it('returns ABORTED when the signal is already aborted, overriding the kit code', () => {
    const error = new MinecraftKitError('NETWORK_HTTP_ERROR', 'boom');
    expect(classifyError(error, abortedSignal())).toBe(MinecraftErrorCodes.ABORTED);
  });

  it('ignores an inactive signal', () => {
    const error = new MinecraftKitError('NETWORK_HTTP_ERROR', 'boom');
    expect(classifyError(error, inactiveSignal)).toBe(MinecraftErrorCodes.NETWORK_ERROR);
  });
});

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});
