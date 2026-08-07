import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import type { SkinHandlers } from '@main/services/skin/skin';
import { UploadSkinPayloadSchema } from '@shared/contracts/skin';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerSkinRoutes = (router: Router, handlers: SkinHandlers): void => {
  router.handle(IPC_CHANNELS.mediaUploadSkin, (rawArgs) => {
    const payload = parseIpcArgs(UploadSkinPayloadSchema, rawArgs, 'Invalid upload payload');
    return handlers.uploadSkin(payload);
  });

  router.handleNoArgs(IPC_CHANNELS.mediaClearSkin, () => {
    return handlers.clearSkin();
  });
};
