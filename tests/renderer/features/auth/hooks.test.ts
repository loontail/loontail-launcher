import { loginErrorCodeFromRejection } from '@renderer/features/auth/hooks';
import { ERROR_CODES } from '@shared/constants';
import { LOGIN_ERROR_CODE } from '@shared/contracts';
import { describe, expect, it } from 'vitest';

describe('loginErrorCodeFromRejection', () => {
  it('carries a coded auth rejection through unchanged', () => {
    expect(
      loginErrorCodeFromRejection({
        code: LOGIN_ERROR_CODE.INVALID_CREDENTIALS,
        message: 'Sign-in failed',
      }),
    ).toBe(LOGIN_ERROR_CODE.INVALID_CREDENTIALS);
  });

  it('falls back to UNKNOWN for structured IPC errors and generic failures', () => {
    expect(
      loginErrorCodeFromRejection({
        code: ERROR_CODES.IPC_HANDLER_FAILED,
        message: 'handler failed',
      }),
    ).toBe(LOGIN_ERROR_CODE.UNKNOWN);
    expect(loginErrorCodeFromRejection(new Error('transport failed'))).toBe(
      LOGIN_ERROR_CODE.UNKNOWN,
    );
    // A TypeError cannot survive the IPC boundary; main has already coded it.
    expect(loginErrorCodeFromRejection(new TypeError('fetch failed'))).toBe(
      LOGIN_ERROR_CODE.UNKNOWN,
    );
  });
});

describe('LOGIN_ERROR_CODE.CANCELLED', () => {
  // useMojangLogin suppresses a cancelled sign-in instead of relying on a ref
  // captured at request time. The code must stay distinct from UNKNOWN so the
  // suppression predicate cannot accidentally swallow a genuine unknown failure.
  it('is distinct from the Unknown code', () => {
    expect(LOGIN_ERROR_CODE.CANCELLED).not.toBe(LOGIN_ERROR_CODE.UNKNOWN);
  });
});
