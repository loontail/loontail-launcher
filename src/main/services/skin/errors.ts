import type { ErrorCode } from '@shared/constants';

export class SkinError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SkinError';
  }
}
