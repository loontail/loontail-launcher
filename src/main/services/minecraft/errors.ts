import {
  type MinecraftKitError,
  type MinecraftKitErrorCode,
  RepairFromErrorSupportedCodes,
  isMinecraftKitError,
} from '@loontail/minecraft-kit';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';

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
  if (error instanceof ManagerError) return error.code;
  if (isMinecraftKitError(error)) {
    return KIT_CODE_TO_LAUNCHER_CODE[error.code] ?? MinecraftErrorCodes.KIT_ERROR;
  }
  return MinecraftErrorCodes.UNKNOWN;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Kit codes from which kit.repair.fromError can derive a focused repair plan.
// Sourced directly from kit so adding a new entry upstream auto-extends our
// smart-resume coverage.
const SMART_RESUME_CODES: ReadonlySet<MinecraftKitErrorCode> = new Set(
  Object.values(RepairFromErrorSupportedCodes),
);

// Returns the narrowed kit error iff smart resume applies, else null.
// Cancellation short-circuits because we honour the user's intent over silent
// recovery.
export const tryAsSmartResumeError = (
  error: unknown,
  signal: AbortSignal,
): MinecraftKitError | null => {
  if (signal.aborted) return null;
  if (!isMinecraftKitError(error)) return null;
  return SMART_RESUME_CODES.has(error.code) ? error : null;
};
