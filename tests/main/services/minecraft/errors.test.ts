import { MinecraftKitError, type MinecraftKitErrorCode } from '@loontail/minecraft-kit';
import { classifyError, MinecraftError } from '@main/services/minecraft/errors';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const inactiveSignal = new AbortController().signal;

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe('MinecraftError', () => {
  it('preserves the launcher error code and message', () => {
    const error = new MinecraftError(MinecraftErrorCodes.NO_ACCOUNT, 'no account');
    expect(error.code).toBe(MinecraftErrorCodes.NO_ACCOUNT);
    expect(error.message).toBe('no account');
    expect(error.name).toBe('MinecraftError');
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
    ['MANIFEST_NOT_FOUND', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['MANIFEST_INVALID', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['METADATA_PARSE_ERROR', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['INTEGRITY_HASH_MISMATCH', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['INTEGRITY_SIZE_MISMATCH', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['ARCHIVE_INVALID', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['ARCHIVE_TOO_LARGE', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['ARCHIVE_ENTRY_REJECTED', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['VERIFICATION_FAILED', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['FILESYSTEM_PATH_TRAVERSAL', MinecraftErrorCodes.INTEGRITY_ERROR],
    ['FILESYSTEM_WRITE_ERROR', MinecraftErrorCodes.DISK_ERROR],
    ['FILESYSTEM_READ_ERROR', MinecraftErrorCodes.DISK_ERROR],
    ['RUNTIME_NOT_FOUND', MinecraftErrorCodes.RUNTIME_ERROR],
    ['RUNTIME_UNSUPPORTED_PLATFORM', MinecraftErrorCodes.RUNTIME_ERROR],
    ['FORGE_PROCESSOR_FAILED', MinecraftErrorCodes.FORGE_ERROR],
    ['FORGE_INSTALLER_INVALID', MinecraftErrorCodes.FORGE_ERROR],
    ['LAUNCH_JAVA_NOT_FOUND', MinecraftErrorCodes.RUNTIME_ERROR],
    ['LAUNCH_PROCESS_FAILED', MinecraftErrorCodes.LAUNCH_FAILED],
    ['LAUNCH_ABORTED', MinecraftErrorCodes.ABORTED],
    ['AUTH_MINECRAFT_FAILED', MinecraftErrorCodes.LAUNCH_FAILED],
    ['AUTH_REFRESH_FAILED', MinecraftErrorCodes.LAUNCH_FAILED],
  ];

  for (const [kitCode, launcherCode] of cases) {
    it(`maps kit ${kitCode} -> ${launcherCode}`, () => {
      const error = new MinecraftKitError(kitCode, kitCode);
      expect(classifyError(error)).toBe(launcherCode);
    });
  }

  it('falls back to KIT_ERROR for an unmapped kit code', () => {
    // NOT_IMPLEMENTED is a valid kit code with no launcher-domain equivalent.
    const error = new MinecraftKitError('NOT_IMPLEMENTED', 'not implemented');
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
