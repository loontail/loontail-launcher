import { loginErrorCodeFromRejection } from '@renderer/features/auth/hooks';
import { ERROR_CODES } from '@shared/constants';
import { LOGIN_ERROR_CODE } from '@shared/contracts';
import { describe, expect, it } from 'vitest';

describe('loginErrorCodeFromRejection', () => {
  it('maps structured auth IPC errors to credential login errors', () => {
    expect(
      loginErrorCodeFromRejection({
        code: ERROR_CODES.AuthInvalidCredentials,
        message: 'invalid credentials',
      }),
    ).toBe(LOGIN_ERROR_CODE.InvalidCredentials);
    expect(
      loginErrorCodeFromRejection({
        code: ERROR_CODES.AuthNetworkError,
        message: 'network failed',
      }),
    ).toBe(LOGIN_ERROR_CODE.NetworkError);
  });

  it('falls back to UNKNOWN for generic IPC and preload failures', () => {
    expect(
      loginErrorCodeFromRejection({
        code: ERROR_CODES.IpcHandlerFailed,
        message: 'handler failed',
      }),
    ).toBe(LOGIN_ERROR_CODE.Unknown);
    expect(loginErrorCodeFromRejection(new Error('transport failed'))).toBe(
      LOGIN_ERROR_CODE.Unknown,
    );
  });
});
