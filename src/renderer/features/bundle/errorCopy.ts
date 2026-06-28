import { type BundleErrorCode, BundleErrorCodes } from '@shared/contracts/bundle';
import type { TFunction } from 'i18next';

const KEY_BY_CODE: Record<BundleErrorCode, string> = {
  [BundleErrorCodes.NO_CLIENT_FOLDER]: 'clients.bundleError.noClientFolder',
  [BundleErrorCodes.MANIFEST_FETCH_FAILED]: 'clients.bundleError.manifestFetchFailed',
  [BundleErrorCodes.MANIFEST_INVALID]: 'clients.bundleError.manifestInvalid',
  [BundleErrorCodes.DOWNLOAD_FAILED]: 'clients.bundleError.downloadFailed',
  [BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED]: 'clients.bundleError.downloadIntegrityFailed',
  [BundleErrorCodes.DELETE_FAILED]: 'clients.bundleError.deleteFailed',
  [BundleErrorCodes.UNSAFE_PATH]: 'clients.bundleError.unsafePath',
  [BundleErrorCodes.HEAL_FAILED]: 'clients.bundleError.healFailed',
  [BundleErrorCodes.ABORTED]: 'clients.bundleError.aborted',
  [BundleErrorCodes.OP_IN_FLIGHT]: 'clients.bundleError.opInFlight',
  [BundleErrorCodes.UNKNOWN]: 'clients.bundleError.unknown',
};

const isBundleErrorCode = (code: string): code is BundleErrorCode => code in KEY_BY_CODE;

// Unknown codes fall back to the generic key, which still surfaces the raw message.
export const localizeBundleError = (code: string, message: string, t: TFunction): string =>
  t(isBundleErrorCode(code) ? KEY_BY_CODE[code] : KEY_BY_CODE[BundleErrorCodes.UNKNOWN], {
    message,
  });
