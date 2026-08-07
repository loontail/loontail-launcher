import { isMinecraftKitError, type MinecraftKitErrorCode } from '@loontail/minecraft-kit';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';

export class MinecraftError extends Error {
  constructor(
    readonly code: MinecraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MinecraftError';
  }
}

const KIT_CODE_TO_LAUNCHER_CODE: Partial<Record<MinecraftKitErrorCode, MinecraftErrorCode>> = {
  NETWORK_TIMEOUT: MinecraftErrorCodes.NETWORK_ERROR,
  NETWORK_HTTP_ERROR: MinecraftErrorCodes.NETWORK_ERROR,
  NETWORK_ABORTED: MinecraftErrorCodes.ABORTED,
  // A missing manifest is a corrupt install (repair fixes it), not a transient network failure.
  MANIFEST_NOT_FOUND: MinecraftErrorCodes.INTEGRITY_ERROR,
  MANIFEST_INVALID: MinecraftErrorCodes.INTEGRITY_ERROR,
  METADATA_PARSE_ERROR: MinecraftErrorCodes.INTEGRITY_ERROR,
  INTEGRITY_HASH_MISMATCH: MinecraftErrorCodes.INTEGRITY_ERROR,
  INTEGRITY_SIZE_MISMATCH: MinecraftErrorCodes.INTEGRITY_ERROR,
  ARCHIVE_INVALID: MinecraftErrorCodes.INTEGRITY_ERROR,
  ARCHIVE_TOO_LARGE: MinecraftErrorCodes.INTEGRITY_ERROR,
  ARCHIVE_ENTRY_REJECTED: MinecraftErrorCodes.INTEGRITY_ERROR,
  VERIFICATION_FAILED: MinecraftErrorCodes.INTEGRITY_ERROR,
  FILESYSTEM_PATH_TRAVERSAL: MinecraftErrorCodes.INTEGRITY_ERROR,
  FILESYSTEM_WRITE_ERROR: MinecraftErrorCodes.DISK_ERROR,
  FILESYSTEM_READ_ERROR: MinecraftErrorCodes.DISK_ERROR,
  RUNTIME_NOT_FOUND: MinecraftErrorCodes.RUNTIME_ERROR,
  RUNTIME_UNSUPPORTED_PLATFORM: MinecraftErrorCodes.RUNTIME_ERROR,
  FORGE_PROCESSOR_FAILED: MinecraftErrorCodes.FORGE_ERROR,
  FORGE_INSTALLER_INVALID: MinecraftErrorCodes.FORGE_ERROR,
  LAUNCH_JAVA_NOT_FOUND: MinecraftErrorCodes.RUNTIME_ERROR,
  LAUNCH_PROCESS_FAILED: MinecraftErrorCodes.LAUNCH_FAILED,
  LAUNCH_ABORTED: MinecraftErrorCodes.ABORTED,
  AUTH_MINECRAFT_FAILED: MinecraftErrorCodes.LAUNCH_FAILED,
  AUTH_REFRESH_FAILED: MinecraftErrorCodes.LAUNCH_FAILED,
};

export const classifyError = (error: unknown, signal?: AbortSignal): MinecraftErrorCode => {
  if (signal?.aborted) return MinecraftErrorCodes.ABORTED;
  if (error instanceof MinecraftError) return error.code;
  if (isMinecraftKitError(error)) {
    return KIT_CODE_TO_LAUNCHER_CODE[error.code] ?? MinecraftErrorCodes.KIT_ERROR;
  }
  return MinecraftErrorCodes.UNKNOWN;
};
