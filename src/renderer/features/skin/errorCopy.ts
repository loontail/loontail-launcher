import { makeCodeLocalizer } from '@renderer/shared/lib/makeCodeLocalizer';
import { type SkinErrorCode, SkinErrorCodes } from '@shared/contracts/skin';

const KEY_BY_CODE: Record<SkinErrorCode, string> = {
  [SkinErrorCodes.NOT_AUTHENTICATED]: 'settings.account.skinError.notAuthenticated',
  [SkinErrorCodes.INVALID_IMAGE]: 'settings.account.skinError.invalidImage',
  [SkinErrorCodes.CAPE_UNSUPPORTED]: 'settings.account.skinError.capeUnsupported',
  [SkinErrorCodes.UPLOAD_FAILED]: 'settings.account.skinError.uploadFailed',
  [SkinErrorCodes.UPLOAD_NO_URL]: 'settings.account.skinError.uploadNoUrl',
  [SkinErrorCodes.CLEAR_FAILED]: 'settings.account.skinError.clearFailed',
};

export const localizeSkinError = makeCodeLocalizer(
  KEY_BY_CODE,
  'settings.account.skinError.unknown',
);
