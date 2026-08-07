import type { SystemErrorCode } from '@shared/contracts/system';

export class SystemError extends Error {
  constructor(
    readonly code: SystemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SystemError';
  }
}
