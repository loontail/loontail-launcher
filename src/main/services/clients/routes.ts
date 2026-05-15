import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
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
    const parsed = parseIpcArgs(ListArgsSchema, args, 'Invalid clients.list payload');
    return getClients(parsed?.locale);
  });
};
