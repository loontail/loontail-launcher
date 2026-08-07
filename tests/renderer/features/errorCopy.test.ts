import { localizeBundleError } from '@renderer/features/bundle/errorCopy';
import { localizeMinecraftError } from '@renderer/features/minecraft/errorCopy';
import { localizeSkinError } from '@renderer/features/skin/errorCopy';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { SkinErrorCodes } from '@shared/contracts/skin';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

// Returns the resolved key so tests can assert which i18n key each code maps to.
const keyEcho = ((key: string) => key) as unknown as TFunction;

const localizers = [
  {
    name: 'minecraft',
    codes: Object.values(MinecraftErrorCodes),
    localize: localizeMinecraftError,
    fallback: 'builds.error.unknown',
  },
  {
    name: 'bundle',
    codes: Object.values(BundleErrorCodes),
    localize: localizeBundleError,
    fallback: 'builds.bundleError.unknown',
  },
  {
    name: 'skin',
    codes: Object.values(SkinErrorCodes),
    localize: localizeSkinError,
    fallback: 'settings.account.skinError.unknown',
  },
] as const;

describe.each(localizers)('$name error copy', ({ codes, localize, fallback }) => {
  it('maps every code to a distinct non-empty key', () => {
    const keys = codes.map((code) => localize(code, 'detail', keyEcho));

    for (const key of keys) {
      expect(key.length).toBeGreaterThan(0);
    }
    expect(new Set(keys).size).toBe(codes.length);
  });

  it('falls back to the unknown key for an unrecognized code', () => {
    expect(localize('NOT_A_REAL_CODE', 'boom', keyEcho)).toBe(fallback);
  });
});
