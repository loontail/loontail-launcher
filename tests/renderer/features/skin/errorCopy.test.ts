import { localizeSkinError } from '@renderer/features/skin/errorCopy';
import { SkinErrorCodes } from '@shared/contracts/skin';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

// Returns the resolved key so tests can assert which i18n key each code maps to.
const keyEcho = ((key: string) => key) as unknown as TFunction;

describe('localizeSkinError', () => {
  it('maps every SkinErrorCode to a distinct non-empty key', () => {
    const codes = Object.values(SkinErrorCodes);
    const keys = codes.map((code) => localizeSkinError(code, 'detail', keyEcho));

    for (const key of keys) {
      expect(key.length).toBeGreaterThan(0);
    }
    expect(new Set(keys).size).toBe(codes.length);
  });

  it('falls back to the unknown key for an unrecognized code', () => {
    expect(localizeSkinError('NOT_A_REAL_CODE', 'boom', keyEcho)).toBe(
      'settings.account.skinError.unknown',
    );
  });

  it('forwards the raw message for interpolation', () => {
    const interpolating = ((key: string, opts?: { message?: string }) =>
      `${key}:${opts?.message ?? ''}`) as unknown as TFunction;
    expect(localizeSkinError(SkinErrorCodes.INVALID_IMAGE, 'bad dims', interpolating)).toBe(
      'settings.account.skinError.invalidImage:bad dims',
    );
  });
});
