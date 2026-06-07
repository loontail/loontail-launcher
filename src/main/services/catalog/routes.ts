import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';
import type { CatalogService } from './catalog';

const ListArgsSchema = z
  .object({
    locale: z.string().min(1).optional(),
  })
  .optional();

export const registerCatalogRoutes = (router: Router, catalog: CatalogService): void => {
  router.handle(IPC_CHANNELS.catalogList, (args) => {
    const parsed = parseIpcArgs(ListArgsSchema, args, 'Invalid catalog.list payload');
    return catalog.list(parsed?.locale);
  });
};
