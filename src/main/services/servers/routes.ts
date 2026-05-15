import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';
import { getServerStatuses } from './servers';

const AddressesSchema = z.array(z.string().min(1));

export const registerServersRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.serversGetStatuses, (args) => {
    const addresses = parseIpcArgs(AddressesSchema, args, 'Invalid addresses payload');
    return getServerStatuses(addresses);
  });
};
