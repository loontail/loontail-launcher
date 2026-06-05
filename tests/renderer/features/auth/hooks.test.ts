import { loginErrorCodeFromRejection } from '@renderer/features/auth/hooks';
import { ERROR_CODES } from '@shared/constants';
import { LOGIN_ERROR_CODE } from '@shared/contracts';
import { describe, expect, it } from 'vitest';

describe('loginErrorCodeFromRejection', () => {
  it('maps a transport-level TypeError to a network login error', () => {
    expect(loginErrorCodeFromRejection(new TypeError('fetch failed'))).toBe(
      LOGIN_ERROR_CODE.NetworkError,
    );
  });

  it('falls back to UNKNOWN for structured IPC errors and generic failures', () => {
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

describe('LOGIN_ERROR_CODE.Cancelled', () => {
  // useMojangLogin suppresses a `Cancelled` result instead of relying on a ref
  // captured at request time. The code must stay distinct from Unknown so the
  // suppression predicate (`result.error !== LOGIN_ERROR_CODE.Cancelled`) cannot
  // accidentally swallow a genuine unknown failure.
  it('is distinct from the Unknown code', () => {
    expect(LOGIN_ERROR_CODE.Cancelled).not.toBe(LOGIN_ERROR_CODE.Unknown);
  });
});
