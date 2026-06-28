import { type BundleErrorCode, BundleErrorCodes } from '@shared/contracts/bundle';

export class BundleError extends Error {
  constructor(
    readonly code: BundleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BundleError';
  }
}

export const classifyBundleError = (error: unknown, signal?: AbortSignal): BundleErrorCode => {
  if (error instanceof BundleError) return error.code;
  if (signal?.aborted) return BundleErrorCodes.ABORTED;
  return BundleErrorCodes.UNKNOWN;
};
