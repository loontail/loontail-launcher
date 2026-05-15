import type { Router } from '@main/ipc/router';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';
import { getServerStatuses } from './servers';

const AddressesSchema = z.array(z.string().min(1));

export const registerServersRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.serversGetStatuses, (args) => {
    const parsed = AddressesSchema.safeParse(args);
    if (!parsed.success) {
      throw { code: ERROR_CODES.IpcInvalidArgs, message: 'Invalid addresses payload' };
    }
    return getServerStatuses(parsed.data);
  });
};
