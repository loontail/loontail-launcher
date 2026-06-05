import type { SkinErrorCode } from '@shared/contracts/skin';

export class SkinError extends Error {
  constructor(
    readonly code: SkinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SkinError';
  }
}
