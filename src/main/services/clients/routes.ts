import type { Router } from '@main/ipc/router';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';
import { getClients } from './clients';

const ListArgsSchema = z
  .object({
    locale: z.string().min(1).optional(),
  })
  .optional();

export const registerClientsRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.clientsList, (args) => {
    const parsed = ListArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw { code: ERROR_CODES.IpcInvalidArgs, message: 'Invalid clients.list payload' };
    }
    return getClients(parsed.data?.locale);
  });
};
