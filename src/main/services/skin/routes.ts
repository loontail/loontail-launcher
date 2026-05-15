import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { clearSkin, uploadSkin } from '@main/services/skin/skin';
import { UploadSkinPayloadSchema } from '@shared/contracts/skin';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerSkinRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.mediaUploadSkin, (rawArgs) => {
    const payload = parseIpcArgs(UploadSkinPayloadSchema, rawArgs, 'Invalid upload payload');
    return uploadSkin(payload);
  });

  router.handle(IPC_CHANNELS.mediaClearSkin, () => clearSkin());
};
