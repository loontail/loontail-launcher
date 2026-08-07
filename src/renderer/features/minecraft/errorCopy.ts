import { makeCodeLocalizer } from '@renderer/shared/lib/makeCodeLocalizer';
import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';

const KEY_BY_CODE: Record<MinecraftErrorCode, string> = {
  [MinecraftErrorCodes.NO_ACCOUNT]: 'builds.error.noAccount',
  [MinecraftErrorCodes.NO_CLIENT_FOLDER]: 'builds.error.noClientFolder',
  [MinecraftErrorCodes.LOADER_AMBIGUOUS]: 'builds.error.loaderAmbiguous',
  [MinecraftErrorCodes.OP_IN_FLIGHT]: 'builds.error.opInFlight',
  [MinecraftErrorCodes.NOT_INSTALLED]: 'builds.error.notInstalled',
  [MinecraftErrorCodes.ABORTED]: 'builds.error.aborted',
  [MinecraftErrorCodes.NETWORK_ERROR]: 'builds.error.networkError',
  [MinecraftErrorCodes.INTEGRITY_ERROR]: 'builds.error.integrityError',
  [MinecraftErrorCodes.DISK_ERROR]: 'builds.error.diskError',
  [MinecraftErrorCodes.RUNTIME_ERROR]: 'builds.error.runtimeError',
  [MinecraftErrorCodes.FORGE_ERROR]: 'builds.error.forgeError',
  [MinecraftErrorCodes.LAUNCH_FAILED]: 'builds.error.launchFailed',
  [MinecraftErrorCodes.KIT_ERROR]: 'builds.error.kitError',
  [MinecraftErrorCodes.UNINSTALL_LOCKED]: 'builds.error.uninstallLocked',
  [MinecraftErrorCodes.UNKNOWN]: 'builds.error.unknown',
};

export const localizeMinecraftError = makeCodeLocalizer(KEY_BY_CODE, 'builds.error.unknown');
