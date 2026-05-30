import { type MinecraftErrorCode, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import type { TFunction } from 'i18next';

const KEY_BY_CODE: Record<MinecraftErrorCode, string> = {
  [MinecraftErrorCodes.NO_ACCOUNT]: 'clients.error.noAccount',
  [MinecraftErrorCodes.NO_CLIENT_FOLDER]: 'clients.error.noClientFolder',
  [MinecraftErrorCodes.LOADER_AMBIGUOUS]: 'clients.error.loaderAmbiguous',
  [MinecraftErrorCodes.OP_IN_FLIGHT]: 'clients.error.opInFlight',
  [MinecraftErrorCodes.NOT_INSTALLED]: 'clients.error.notInstalled',
  [MinecraftErrorCodes.ABORTED]: 'clients.error.aborted',
  [MinecraftErrorCodes.NETWORK_ERROR]: 'clients.error.networkError',
  [MinecraftErrorCodes.INTEGRITY_ERROR]: 'clients.error.integrityError',
  [MinecraftErrorCodes.DISK_ERROR]: 'clients.error.diskError',
  [MinecraftErrorCodes.RUNTIME_ERROR]: 'clients.error.runtimeError',
  [MinecraftErrorCodes.FORGE_ERROR]: 'clients.error.forgeError',
  [MinecraftErrorCodes.LAUNCH_FAILED]: 'clients.error.launchFailed',
  [MinecraftErrorCodes.KIT_ERROR]: 'clients.error.kitError',
  [MinecraftErrorCodes.UNINSTALL_LOCKED]: 'clients.error.uninstallLocked',
  [MinecraftErrorCodes.UNKNOWN]: 'clients.error.unknown',
};

export const localizeMinecraftError = (
  code: MinecraftErrorCode,
  message: string,
  t: TFunction,
): string => t(KEY_BY_CODE[code], { message });
