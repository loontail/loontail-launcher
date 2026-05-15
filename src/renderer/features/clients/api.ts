import type { Client } from '@shared/contracts/client';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import type { StrapiList } from '@shared/contracts/strapi';
import { IPC_CHANNELS } from '@shared/ipc';

export const getClients = (locale?: string): Promise<StrapiList<Client>> =>
  window.api.invoke(IPC_CHANNELS.clientsList, locale ? { locale } : {});

export const getServerStatuses = (addresses: string[]): Promise<ServerStatus[]> =>
  window.api.invoke(IPC_CHANNELS.serversGetStatuses, addresses);
