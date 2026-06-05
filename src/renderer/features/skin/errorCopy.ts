import { type SkinErrorCode, SkinErrorCodes } from '@shared/contracts/skin';
import type { TFunction } from 'i18next';

const KEY_BY_CODE: Record<SkinErrorCode, string> = {
  [SkinErrorCodes.NOT_AUTHENTICATED]: 'settings.account.skinError.notAuthenticated',
  [SkinErrorCodes.INVALID_IMAGE]: 'settings.account.skinError.invalidImage',
  [SkinErrorCodes.CAPE_UNSUPPORTED]: 'settings.account.skinError.capeUnsupported',
  [SkinErrorCodes.UPLOAD_FAILED]: 'settings.account.skinError.uploadFailed',
  [SkinErrorCodes.UPLOAD_NO_URL]: 'settings.account.skinError.uploadNoUrl',
  [SkinErrorCodes.CLEAR_FAILED]: 'settings.account.skinError.clearFailed',
};

const FALLBACK_KEY = 'settings.account.skinError.unknown';

const isSkinErrorCode = (code: string): code is SkinErrorCode => code in KEY_BY_CODE;

// Resolves an IpcError code (arrives as a plain string over the bridge) to a
// localized, code-keyed message. Unknown codes fall back to a generic key that
// still surfaces the raw main-process message for diagnostics.
export const localizeSkinError = (code: string, message: string, t: TFunction): string => {
  const key = isSkinErrorCode(code) ? KEY_BY_CODE[code] : FALLBACK_KEY;
  return t(key, { message });
};
