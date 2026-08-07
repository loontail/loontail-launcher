import type { ServerStatus } from '@shared/contracts/serverStatus';
import { IPC_CHANNELS } from '@shared/ipc';

export const getServerStatuses = (addresses: string[]): Promise<ServerStatus[]> =>
  window.api.invoke(IPC_CHANNELS.serversGetStatuses, addresses);
