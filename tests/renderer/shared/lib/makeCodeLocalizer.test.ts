import { makeCodeLocalizer } from '@renderer/shared/lib/makeCodeLocalizer';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

const KEY_BY_CODE = { KNOWN: 'feature.error.known' } as const;
const FALLBACK_KEY = 'feature.error.unknown';

const localize = makeCodeLocalizer(KEY_BY_CODE, FALLBACK_KEY);

// Echoes the resolved key plus the interpolated message.
const keyEcho = ((key: string, opts?: { message?: string }) =>
  `${key}:${opts?.message ?? ''}`) as unknown as TFunction;

describe('makeCodeLocalizer', () => {
  it('maps a known code to its key', () => {
    expect(localize('KNOWN', 'boom', keyEcho)).toBe('feature.error.known:boom');
  });

  it('falls back to the fallback key for an unknown code', () => {
    expect(localize('NOT_A_REAL_CODE', 'boom', keyEcho)).toBe('feature.error.unknown:boom');
  });

  it('never resolves an inherited Object.prototype member to a key', () => {
    expect(localize('toString', 'boom', keyEcho)).toBe('feature.error.unknown:boom');
  });
});
