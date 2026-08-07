import type { LoginErrorCode } from '@shared/contracts/auth';

export class AuthError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
