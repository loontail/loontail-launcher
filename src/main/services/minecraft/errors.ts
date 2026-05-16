import { isMinecraftKitError } from '@loontail/minecraft-kit';
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

export const classifyError = (error: unknown, signal?: AbortSignal): MinecraftErrorCode => {
  if (signal?.aborted) return MinecraftErrorCodes.ABORTED;
  if (isMinecraftKitError(error)) return MinecraftErrorCodes.KIT_ERROR;
  return MinecraftErrorCodes.UNKNOWN;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
