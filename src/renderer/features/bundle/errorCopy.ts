import { makeCodeLocalizer } from '@renderer/shared/lib/makeCodeLocalizer';
import { type BundleErrorCode, BundleErrorCodes } from '@shared/contracts/bundle';

const KEY_BY_CODE: Record<BundleErrorCode, string> = {
  [BundleErrorCodes.NO_CLIENT_FOLDER]: 'builds.bundleError.noClientFolder',
  [BundleErrorCodes.MANIFEST_FETCH_FAILED]: 'builds.bundleError.manifestFetchFailed',
  [BundleErrorCodes.MANIFEST_INVALID]: 'builds.bundleError.manifestInvalid',
  [BundleErrorCodes.DOWNLOAD_FAILED]: 'builds.bundleError.downloadFailed',
  [BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED]: 'builds.bundleError.downloadIntegrityFailed',
  [BundleErrorCodes.DELETE_FAILED]: 'builds.bundleError.deleteFailed',
  [BundleErrorCodes.UNSAFE_PATH]: 'builds.bundleError.unsafePath',
  [BundleErrorCodes.HEAL_FAILED]: 'builds.bundleError.healFailed',
  [BundleErrorCodes.ABORTED]: 'builds.bundleError.aborted',
  [BundleErrorCodes.OP_IN_FLIGHT]: 'builds.bundleError.opInFlight',
  [BundleErrorCodes.UNKNOWN]: 'builds.bundleError.unknown',
};

export const localizeBundleError = makeCodeLocalizer(KEY_BY_CODE, 'builds.bundleError.unknown');
