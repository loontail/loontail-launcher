import type { Router } from '@main/ipc/router';
import { clearSkin, uploadSkin } from '@main/services/skin/skin';
import { ERROR_CODES } from '@shared/constants';
import { UploadSkinPayloadSchema } from '@shared/contracts/skin';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerSkinRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.mediaUploadSkin, (rawArgs) => {
    const parsed = UploadSkinPayloadSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.IpcInvalidArgs,
        message: 'Invalid upload payload',
        details: parsed.error.format(),
      };
    }
    return uploadSkin(parsed.data);
  });

  router.handle(IPC_CHANNELS.mediaClearSkin, () => clearSkin());
};
