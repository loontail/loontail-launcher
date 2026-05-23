import { type MinecraftKitErrorCodes, isMinecraftKitError } from '@loontail/minecraft-kit';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';

type MinecraftKitErrorCode = (typeof MinecraftKitErrorCodes)[keyof typeof MinecraftKitErrorCodes];

export class ManagerError extends Error {
  constructor(
    readonly code: MinecraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManagerError';
  }
}

const KIT_CODE_TO_LAUNCHER_CODE: Partial<Record<MinecraftKitErrorCode, MinecraftErrorCode>> = {
  NETWORK_TIMEOUT: MinecraftErrorCodes.NETWORK_ERROR,
  NETWORK_HTTP_ERROR: MinecraftErrorCodes.NETWORK_ERROR,
  NETWORK_ABORTED: MinecraftErrorCodes.ABORTED,
  MANIFEST_NOT_FOUND: MinecraftErrorCodes.NETWORK_ERROR,
  INTEGRITY_HASH_MISMATCH: MinecraftErrorCodes.INTEGRITY_ERROR,
  INTEGRITY_SIZE_MISMATCH: MinecraftErrorCodes.INTEGRITY_ERROR,
  RUNTIME_NOT_FOUND: MinecraftErrorCodes.RUNTIME_ERROR,
  RUNTIME_UNSUPPORTED_PLATFORM: MinecraftErrorCodes.RUNTIME_ERROR,
  LAUNCH_JAVA_NOT_FOUND: MinecraftErrorCodes.RUNTIME_ERROR,
  LAUNCH_PROCESS_FAILED: MinecraftErrorCodes.LAUNCH_FAILED,
  LAUNCH_ABORTED: MinecraftErrorCodes.ABORTED,
};

export const classifyError = (error: unknown, signal?: AbortSignal): MinecraftErrorCode => {
  if (signal?.aborted) return MinecraftErrorCodes.ABORTED;
  if (isMinecraftKitError(error)) {
    return KIT_CODE_TO_LAUNCHER_CODE[error.code] ?? MinecraftErrorCodes.KIT_ERROR;
  }
  return MinecraftErrorCodes.UNKNOWN;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
